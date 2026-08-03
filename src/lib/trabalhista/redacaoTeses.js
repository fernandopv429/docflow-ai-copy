import { base44 } from '@/api/base44Client';
import { invokeLLMComRetry } from './llmRetry';
import { BLOCO_ENGENHARIA_JURIDICA } from './engenhariaJuridica';
import { BLOCO_REGRAS_QUALIDADE } from './regrasQualidadeFav';
import { BLOCO_MATRIZ_TOPICOS } from './matrizTopicos';
import { blocoRegrasCriticas } from './regrasCriticas';
import { formatBRL } from './mathUtils';

// ============================================================
// REDAÇÃO POR IA — ANÁLISE ÚNICA (um único LLM para todos os capítulos)
//
// Antes: 6 especialistas, 6 chamadas paralelas (uma por tópico).
// Agora: 1 única chamada à IA, que escreve TODOS os capítulos ativos
// da peça em um único retorno JSON. O cálculo continua 100%
// determinístico (mathUtils); a IA nunca faz aritmética nem inventa
// cláusula. A junção final é mecânica (cada bloco vai para o seu
// {{BLOCO_*}} do template) — não há IA "costurando".
//
// Registro DETERMINÍSTICO: o código decide quais capítulos acendem,
// qual campo do template cada um preenche e o recorte (instrucao). O
// texto editável fica em EspecialistaConfig.prompt_sistema (casado por
// `numero`); quando houver mais de um ativo, o modelo usado é o do
// primeiro config encontrado (fallback claude_sonnet_4_6).
// ============================================================
// Sanitiza a saída da IA: remove QUALQUER valor monetário (R$ X,XX) que o
// modelo possa ter inserido na narrativa. Garantia determinística — os
// valores oficiais são exclusivamente os do rol calculado por código
// (mathUtils). A IA é instruída a não citar valores; esta função é a rede
// de segurança caso desobedeça.
function sanitizarValoresIA(texto) {
  if (!texto) return texto;
  return texto
    .replace(/R\$\s*\d[\d.\s]*,\d{2}/gi, '')
    .replace(/R\$\s*\d[\d.,]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

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
    // Instrução dinâmica: só instrua os tópicos extras quando as flags
    // correspondentes estiverem acesas (evita a IA escrever tese não aplicável).
    instrucao: (d, c) => {
      let base =
        'Escreva APENAS o bloco de jornada: descaracterização da escala relatada (ex.: 12x36 – Súmula 85), intervalo intrajornada (art. 71 CLT), minutos residuais antes/depois e DSR/folgas trabalhadas — tratando EXCLUSIVAMENTE a escala efetivamente relatada. NÃO escreva dano moral, rescisão nem enquadramento funcional.';
      const extras = [];
      if (d.periculosidade) {
        extras.push(
          'Adicional de periculosidade incidente sobre as horas extras e o adicional noturno (Súmula 132, I do TST e OJ SDI-1 nº 259 do E. TST) — peça as diferenças de todo o período contratual, com reflexos em DSR, aviso prévio, férias +1/3, 13º e FGTS +40%.'
        );
      }
      if (d.adicional_noturno) {
        extras.push(
          'Adicional noturno e hora noturna reduzida (art. 73 da CLT) — peça as diferenças do percentual e da redução da hora noturna, com reflexos em DSR, aviso prévio, férias +1/3, 13º e FGTS +40%.'
        );
      }
      if (d.folgas_trabalhadas) {
        extras.push(
          'Horas extras em folgas e feriados com adicional de 100% (Súmula 444 do TST) — peça o pagamento em dobro do descanso nos feriados laborados, com reflexos.'
        );
      }
      return extras.length ? `${base}\nTÓPICOS ADICIONAIS (conforme os dados do caso): ${extras.join(' ')}` : base;
    },
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em jornada de trabalho. Redija o bloco de jornada em prosa jurídica fluida e natural, organizado nos quatro blocos legais (fatos, fundamento legal, jurisprudência, pedido), evitando o padrão enlatado repetitivo.',
  },
  {
    numero: 'dano_moral',
    nome: 'Dano moral',
    campo: 'BLOCO_DANO_MORAL',
    ativo: (d, c) => !!c.tem_dano_moral,
    instrucao:
      'Escreva APENAS a narrativa CONCRETA dos fatos do dano moral — 2 a 4 frases articuladas em prosa jurídica fluida e COERENTE, sem fragmentos soltos nem frases isoladas, incorporando os abusos relatados (campos dano_fatos/dano_supervisor: nome do supervisor, perseguição, humilhação, desconto indevido de consignado, etc.). NÃO escreva a fundamentação constitucional/doutrinária (art. 5º, V/X, CF; art. 186, CC) — ela já consta do template antes deste bloco. NÃO trate de jornada, rescisão nem verbas. NÃO cite valores em R$.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em dano moral. Redija APENAS a narrativa concreta dos fatos (os abusos específicos sofridos pelo reclamante), em prosa articulada e coerente — sem a fundamentação doutrinária (já presente no template) e sem valores em R$ (calculados por código).',
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
  {
    numero: 'multas_convencionais',
    nome: 'Multas convencionais',
    campo: 'BLOCO_MULTAS_CONVENCIONAIS',
    ativo: (d, c) => !!(c.cct_ano || c.sindicato || d.periculosidade || d.assiduidade || d.folgas_trabalhadas || d.desvio_funcao || d.acumulo_funcao || d.dez_minutos_cct),
    instrucao: (d, c) =>
      'Escreva APENAS o parágrafo de ABERTURA da seção "DAS MULTAS CONVENCIONAIS" — um parágrafo RICO e COERENTE em prosa jurídica fluida (NÃO uma frase solta nem mera troca de palavra), requerendo a aplicação da multa convencional prevista na Convenção Coletiva de Trabalho da categoria' +
      (c.cct_ano ? ` (vigência ${c.cct_ano} e anteriores)` : '') +
      (c.cct_clausula_multa ? `, nos termos da cláusula ${c.cct_clausula_multa} da referida convenção` : ', nos termos da cláusula de penalidade da referida convenção') +
      ', por descumprimento, pela reclamada, das obrigações convencionais a seguir elencadas. Encerre o parágrafo com transição que introduza a lista de infrações (ex.: "...a seguir elencadas:"). NÃO escreva a lista de infrações (ela já está no template). NÃO cite valores em R$.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em direito coletivo e multas convencionais. Redija o parágrafo de abertura da seção de multas convencionais em prosa jurídica rica e coerente, sem valores em R$ e sem reproduzir a lista de infrações.',
  },
];

// Modelos aceitos pelo InvokeLLM; qualquer outro cai no padrão estável.
const MODELOS_VALIDOS = {
  claude_opus_4_6: 'claude_opus_4_6',
  claude_sonnet_4_6: 'claude_sonnet_4_6',
  gemini_3_1_pro: 'gemini_3_1_pro',
};
function modeloUnico(configs) {
  for (const cfg of configs || []) {
    if (MODELOS_VALIDOS[cfg?.modelo_ia]) return MODELOS_VALIDOS[cfg.modelo_ia];
  }
  return 'claude_sonnet_4_6';
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

// Contexto COMPARTILHADO da análise única. Fica no prompt da chamada —
// prefixo estável, pronto para prompt caching quando o provedor/SDK
// expuser esse controle (hoje reenviado por chamada).
export function montarContextoCompartilhado({ caso, calculos, dadosCct, blocosAtivos }) {
  return [
    'CONTEXTO COMPLETO DO CASO (leia tudo; você escreverá TODOS os capítulos ativos em uma única resposta JSON).',
    BLOCO_ENGENHARIA_JURIDICA,
    BLOCO_REGRAS_QUALIDADE,
    BLOCO_MATRIZ_TOPICOS,
    blocoRegrasCriticas({ municipios: municipiosDoCaso(caso) }),
    '',
    'REGRAS DE SEGURANÇA (obrigatórias):',
    '- Argumente SOMENTE sobre fatos presentes no caso. Se faltar um fato essencial, escreva [CONFIRMAR: ...] em vez de inventar.',
    '- NÃO cite valores monetários (R$) nos capítulos nem faça aritmética. Todos os valores (rescisão, aviso prévio, 13º, férias, FGTS+multa, dano moral, honorários) são calculados por código e figuram APENAS no rol de pedidos. Mencione os reflexos (DSR, aviso prévio, férias +1/3, 13º, FGTS +40%) de forma qualitativa, sem números. Qualquer "R$ ..." no seu texto será removido pela pós-edição — não os inclua.',
    '- Cite SOMENTE as cláusulas listadas em CLÁUSULAS DA CCT. Nunca invente número de cláusula.',
    '- Escreva APENAS os capítulos solicitados abaixo. NÃO escreva endereçamento, qualificação das partes, valor da causa, honorários, data ou fecho — o sistema gera isso.',
    '- ESTRUTURA FIXA — quatro blocos legais por capítulo, nesta ordem: (1) FATOS — narre o que ocorreu no caso concreto em prosa articulada (sem bullets mecânicos); (2) FUNDAMENTO LEGAL/NORMATIVO — cite dispositivos da CLT, Súmulas do TST e cláusulas da CCT integrados ao texto (não como lista solta); (3) JURISPRUDÊNCIA — trate, quando relevante, a interpretação que ampara a tese; (4) PEDIDO/CONCLUSÃO — formule o requerimento com os reflexos (DSR, aviso prévio, férias+1/3, 13º, FGTS+40%).',
    '- REDAÇÃO NATURAL: escreva em parágrafos jurídicos coesos e fluídos, como um advogado experiente em uma petição — NÃO use o padrão rígido "fato → artigo → Súmula → impugnação → pedido" repetido mecanicamente em cada capítulo. Varie a construção das frases, encadeie os argumentos e evite listas/colchetes e linguagem robótica; o texto deve soar natural, não enlatado.',
    '- Mantenha a impugnação da defesa (Súmula 338) e os reflexos quando cabíveis, mas inseridos organicamente no bloco de pedido, não como etapa idêntica obrigatória em todos os capítulos.',
    '- Cada capítulo NÃO deve invadir o tópico de outro. Respeite o escopo indicado em cada um.',
    '- CONCORDÂNCIA DE GÊNERO: o campo recl_genero indica "M" (masculino) ou "F" (feminino). Escreva TODA a narrativa do capítulo na flexão correta do reclamante — use "reclamante" como substantivo (nunca "autor") e flexione adjetivos e particípios adequadamente (ex.: M → "o reclamante foi admitido/compelido/dispensado/contratado"; F → "a reclamante foi admitida/compelida/dispensada/contratada"). Não troque o gênero de "reclamada" (a empresa).',
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
    `CAPÍTULOS ATIVOS NESTA PEÇA: ${blocosAtivos.join(', ')}.`,
  ].join('\n');
}

// Orquestrador: acende os capítulos conforme as flags (determinístico),
// faz UMA ÚNICA chamada à IA devolvendo TODOS os capítulos ativos de
// uma vez (JSON) e devolve os blocos por campo do template.
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

  // Schema JSON dinâmico: uma propriedade string por capítulo ativo.
  // O root é sempre "object" (req. do InvokeLLM).
  const properties = {};
  const tarefas = ativos.map((e) => {
    const cfg = cfgPorNumero.get(e.numero);
    const promptSistema = cfg?.prompt_sistema || e.promptPadrao;
    const instrucao = typeof e.instrucao === 'function' ? e.instrucao(d, c) : e.instrucao;
    properties[e.campo] = {
      type: 'string',
      description: `Capítulo: ${e.nome}. ${instrucao} Papel: ${promptSistema}`,
    };
    return `### ${e.campo} — ${e.nome}\nPapel: ${promptSistema}\nTarefa: ${instrucao}`;
  });

  notify(`Redigindo ${ativos.length} capítulo(s) em análise única (uma chamada à IA)...`);

  const prompt = [
    contexto,
    '',
    '=============================',
    'TAREFA ÚNICA: escreva TODOS os capítulos abaixo em UMA resposta JSON.',
    'Cada chave do JSON é o campo do template; o valor é o texto do capítulo em português jurídico, sem rótulo "Capítulo X" e sem comentários.',
    'Não inclua nenhum texto fora do JSON. Campos sem informação: retorne string vazia.',
    '',
    'CAPÍTULOS A REDIGIR (escreva todos):',
    tarefas.join('\n\n'),
  ].join('\n');

  const model = modeloUnico(configs);

  try {
    const r = await invokeLLMComRetry(
      { prompt, model, response_json_schema: { type: 'object', properties } },
      { onRetry: (n) => notify(`Reintento ${n} — análise única...`) }
    );
    const obj = (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};

    const blocos = {};
    for (const e of ativos) {
      const texto = typeof obj[e.campo] === 'string' ? obj[e.campo].trim() : '';
      if (texto) blocos[e.campo] = sanitizarValoresIA(texto);
    }
    const escritos = Object.keys(blocos);
    if (escritos.length) notify(`Análise única concluída: ${escritos.length}/${ativos.length} capítulo(s) redigido(s).`);
    else notify('Análise única não retornou capítulos — a peça segue com o texto-padrão do template.');
    return { blocos, especialistasUsados: blocosAtivos };
  } catch (err) {
    notify(`Falha na análise única: ${err.message}`);
    return { blocos: {}, especialistasUsados: blocosAtivos };
  }
}