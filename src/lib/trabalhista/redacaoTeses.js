import { base44 } from '@/api/base44Client';
import { invokeLLMComRetry } from './llmRetry';
import { BLOCO_ENGENHARIA_JURIDICA } from './engenhariaJuridica';
import { blocoRegrasCriticas } from './regrasCriticas';
import { formatBRL } from './mathUtils';

// ============================================================
// REDAÇÃO POR ESPECIALISTAS DE IA (por tópico, contexto completo)
//
// Estratégia: TODOS os especialistas recebem o MESMO contexto completo
// (caso + CCT + valores determinísticos + preâmbulo), mas cada um redige
// APENAS o seu capítulo. O cálculo continua 100% determinístico (mathUtils);
// a IA nunca faz aritmética nem inventa cláusula. A junção final é mecânica
// (cada bloco vai para o seu {{BLOCO_*}} do template) — não há IA "costurando".
//
// Registro DETERMINÍSTICO: o código decide quais capítulos acendem, qual campo
// do template cada um preenche e o recorte (instrucao). O texto editável de
// cada especialista fica em EspecialistaConfig.prompt_sistema (casado por `numero`).
// ============================================================
export const ESPECIALISTAS = [
  {
    numero: 'espinha',
    nome: 'Espinha da rescisão',
    campo: 'BLOCO_ESPINHA_RESCISAO',
    ativo: () => true,
    instrucao:
      'Escreva APENAS o capítulo da modalidade de rescisão aplicável (conforme tipo_dispensa): a fundamentação da tese rescisória e o rol de faltas/argumentos correspondente. NÃO escreva jornada, dano moral, verbas rescisórias calculadas nem qualquer outro tópico.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em teses rescisórias (dispensa sem justa causa; rescisão indireta – art. 483 CLT; reversão de justa causa – art. 482 CLT; nulidade de pedido de demissão por coação – art. 9º CLT; e acordo – art. 484-A CLT). Redija o capítulo da modalidade correta com técnica e fundamentação legal.',
  },
  {
    numero: 'jornada',
    nome: 'Jornada e horas extras',
    campo: 'BLOCO_JORNADA',
    ativo: (d, c) => !!(d.escala_12x36 || d.escala_4x2 || c.jornada_horario || d.folgas_trabalhadas),
    instrucao:
      'Escreva APENAS o bloco de jornada: descaracterização da escala relatada (ex.: 12x36 – Súmula 85), intervalo intrajornada (art. 71 CLT), minutos residuais antes/depois e DSR/folgas trabalhadas — tratando EXCLUSIVAMENTE a escala efetivamente relatada. NÃO escreva dano moral, rescisão nem enquadramento funcional.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em jornada de trabalho. Redija o bloco de jornada seguindo o micropadrão: fato → artigo da CLT + Súmula do TST + cláusula da CCT → impugnação (Súmula 338) → pedido com reflexos.',
  },
  {
    numero: 'dano_moral',
    nome: 'Dano moral',
    campo: 'BLOCO_DANO_MORAL',
    ativo: (d, c) => !!c.tem_dano_moral,
    instrucao:
      'Escreva APENAS o capítulo de dano moral, INCORPORANDO a narrativa concreta dos abusos relatados (campos dano_fatos/dano_supervisor) à fundamentação doutrinária padrão. NÃO trate de jornada, rescisão nem verbas.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em dano moral trabalhista. Redija o capítulo com a fundamentação doutrinária padrão e a narrativa concreta do caso. O valor é 10x a maior remuneração — mas NÃO calcule; use o valor fornecido em VALORES CALCULADOS.',
  },
  {
    numero: 'enquadramento',
    nome: 'Enquadramento funcional',
    campo: 'BLOCO_ENQUADRAMENTO',
    ativo: (d) => !!(d.desvio_funcao || d.acumulo_funcao || d.gratificacao_funcao),
    instrucao:
      'Escreva APENAS o capítulo de enquadramento funcional. Desvio, acúmulo e gratificação são ALTERNATIVOS sobre os mesmos fatos — escolha o correto conforme os dados e NUNCA cumule desvio com acúmulo (bis in idem). NÃO trate de jornada, dano moral nem rescisão.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em desvio, acúmulo e gratificação de função. Redija o capítulo correto conforme o enquadramento, com a multa convencional correspondente, evitando bis in idem.',
  },
  {
    numero: 'sumula331',
    nome: 'Responsabilidade subsidiária (Súmula 331)',
    campo: 'BLOCO_SUMULA_331',
    ativo: (d) => !!d.tem_tomadora,
    instrucao:
      'Escreva APENAS o capítulo de responsabilidade subsidiária da 2ª reclamada (tomadora), com fundamento na Súmula 331 do TST. NÃO trate de outros tópicos.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em terceirização e responsabilidade subsidiária (Súmula 331 do TST). Redija o capítulo pedindo a condenação subsidiária da tomadora pelos créditos deferidos.',
  },
];

// Modelos aceitos pelo InvokeLLM; qualquer outro cai no padrão estável.
const MODELOS_VALIDOS = {
  claude_opus_4_6: 'claude_opus_4_6',
  claude_sonnet_4_6: 'claude_sonnet_4_6',
  gemini_3_1_pro: 'gemini_3_1_pro',
};
function modeloDoEspecialista(cfg) {
  return MODELOS_VALIDOS[cfg?.modelo_ia] || 'claude_sonnet_4_6';
}

function resumoCalculos(calculos) {
  const linhas = (calculos || [])
    .filter((c) => c.valor != null)
    .map((c) => `- ${c.item}: ${formatBRL(c.valor)} (${c.memoria})`);
  return linhas.length ? linhas.join('\n') : '(sem valores calculados disponíveis)';
}

function resumoCct(dadosCct) {
  const cl = dadosCct?.clausulas || [];
  if (!cl.length) {
    return '(nenhuma cláusula de CCT disponível — NÃO cite número de cláusula; use apenas dispositivos legais e Súmulas.)';
  }
  return cl
    .slice(0, 12)
    .map((c) => {
      const ref = c.clausula_ref || '(cláusula)';
      const tit = c.titulo || '';
      const corpo = (c.ementa || c.texto || c.conteudo || '').replace(/\s+/g, ' ').slice(0, 240);
      return `- ${ref} — ${tit}: ${corpo}`;
    })
    .join('\n');
}

const CAMPOS_CASO = [
  'recl_nome', 'recl_genero', 'funcao', 'tipo_dispensa', 'data_admissao', 'data_rescisao',
  'salario', 'maior_remuneracao', 'escala', 'jornada_horario', 'intervalo_usufruido',
  'prorrogacao_jornada', 'ft_qtd_media', 'acumulo_atividades', 'desvio_atividades',
  'dano_fatos', 'dano_supervisor', 'recl1_nome', 'recl2_nome', 'sindicato', 'cct_ano',
  'comarca_uf', 'local_prestacao',
];
function resumoCaso(caso) {
  const obj = {};
  for (const k of CAMPOS_CASO) {
    if (caso[k] != null && caso[k] !== '') obj[k] = caso[k];
  }
  return JSON.stringify(obj, null, 2);
}

function municipiosDoCaso(caso) {
  const out = [];
  if (caso.comarca) out.push(caso.comarca);
  const m = /([A-Za-zÀ-ÿ\s'.-]+?)\s*[-/]\s*[A-Z]{2}\b/.exec(caso.local_prestacao || '');
  if (m) out.push(m[1].trim());
  return out;
}

// Contexto COMPARTILHADO (idêntico para todos os especialistas). Fica no início
// do prompt de cada chamada — prefixo estável, pronto para prompt caching quando
// o provedor/SDK expuser esse controle (hoje reenviado por chamada).
export function montarContextoCompartilhado({ caso, calculos, dadosCct, blocosAtivos }) {
  return [
    'CONTEXTO COMPLETO DO CASO (leia tudo; você é responsável por escrever UM único capítulo).',
    BLOCO_ENGENHARIA_JURIDICA,
    blocoRegrasCriticas({ municipios: municipiosDoCaso(caso) }),
    '',
    'REGRAS DE SEGURANÇA (obrigatórias):',
    '- Argumente SOMENTE sobre fatos presentes no caso. Se faltar um fato essencial, escreva [CONFIRMAR: ...] em vez de inventar.',
    '- NÃO faça aritmética. Use exatamente os valores de VALORES CALCULADOS.',
    '- Cite SOMENTE as cláusulas listadas em CLÁUSULAS DA CCT. Nunca invente número de cláusula.',
    '- Escreva APENAS o capítulo indicado. NÃO escreva endereçamento, qualificação das partes, valor da causa, honorários, data ou fecho — o sistema gera isso.',
    '- Padrão de redação: fato → fundamento legal (CLT) + Súmula do TST + cláusula da CCT → impugnação (Súmula 338, quando couber) → pedido com reflexos (DSR, aviso, férias+1/3, 13º, FGTS+40%).',
    '',
    'DADOS DO CASO:',
    resumoCaso(caso),
    '',
    'VALORES CALCULADOS (determinísticos — USE ESTES NÚMEROS, NÃO RECALCULE):',
    resumoCalculos(calculos),
    '',
    'CLÁUSULAS DA CCT (grounding — só cite estas):',
    resumoCct(dadosCct),
    '',
    `CAPÍTULOS ATIVOS NESTA PEÇA (para você não invadir o tópico de outro especialista): ${blocosAtivos.join(', ')}.`,
  ].join('\n');
}

// Orquestrador: acende os especialistas conforme as flags (determinístico),
// roda os ativos EM PARALELO (com llmRetry) e devolve os blocos por campo.
export async function redigirTesesIA({ caso, calculos, dadosCct, dados, onTool } = {}) {
  const notify = (m) => { try { onTool?.(m); } catch (e) { /* ignora */ } };

  let configs = [];
  try {
    configs = await base44.entities.EspecialistaConfig.filter({ ativo: true });
  } catch (e) {
    configs = [];
  }
  const cfgPorNumero = new Map((configs || []).map((c) => [String(c.numero), c]));

  const d = dados || {};
  const c = caso || {};
  const ativos = ESPECIALISTAS.filter((e) => {
    try { return e.ativo(d, c); } catch (err) { return false; }
  });
  if (!ativos.length) return { blocos: {}, especialistasUsados: [] };

  const blocosAtivos = ativos.map((e) => e.nome);
  const contexto = montarContextoCompartilhado({ caso: c, calculos: calculos || [], dadosCct, blocosAtivos });

  notify(`Redigindo ${ativos.length} capítulo(s) por especialistas de IA (contexto completo, escrita por tópico)...`);

  const resultados = await Promise.all(
    ativos.map(async (e) => {
      const cfg = cfgPorNumero.get(e.numero);
      const promptSistema = cfg?.prompt_sistema || e.promptPadrao;
      const model = modeloDoEspecialista(cfg);
      const prompt = [
        contexto,
        '',
        '=============================',
        `SEU PAPEL: ${promptSistema}`,
        `SUA TAREFA: ${e.instrucao}`,
        'Responda APENAS com o texto do capítulo, em português jurídico, sem rótulo "Capítulo X" e sem comentários.',
      ].join('\n');
      try {
        const r = await invokeLLMComRetry({ prompt, model }, { onRetry: (n) => notify(`Reintento ${n} — ${e.nome}...`) });
        const texto = typeof r === 'string' ? r : (r?.text || r?.output || r?.reply || String(r || ''));
        notify(`Capítulo redigido: ${e.nome}`);
        return { campo: e.campo, texto: (texto || '').trim() };
      } catch (err) {
        notify(`Falha ao redigir "${e.nome}": ${err.message}`);
        return { campo: e.campo, texto: '' };
      }
    })
  );

  const blocos = {};
  for (const r of resultados) if (r.texto) blocos[r.campo] = r.texto;
  return { blocos, especialistasUsados: blocosAtivos };
}
