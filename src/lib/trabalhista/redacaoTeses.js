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
      'Escreva o capítulo COMPLETO da modalidade de rescisão aplicável (conforme tipo_dispensa), em prosa jurídica fluida, articulada e SUBSTANCIAL (NÃO frases curtas, resumos ou bullet points soltos): (1) FATOS — narre, com base nos dados do caso, a situação que configura a modalidade (data e circunstâncias do desligamento, condutas do empregador que fundamentam a tese); (2) FUNDAMENTO LEGAL/NORMATIVO — desenvolva a fundamentação da tese rescisória e o rol de faltas/argumentos correspondente, citando os dispositivos da CLT aplicáveis (art. 482, 483, 484-A, 165 etc.); (3) JURISPRUDÊNCIA — trate, quando relevante, a interpretação que ampara a tese; (4) PEDIDO/CONCLUSÃO — formule o requerimento (reconhecimento da rescisão indireta, nulidade do pedido de demissão, reversão da justa causa etc.) com os reflexos cabíveis. Desenvolva cada bloco em vários parágrafos coesos. NÃO escreva jornada, dano moral, verbas rescisórias calculadas nem qualquer outro tópico.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em teses rescisórias (dispensa sem justa causa; rescisão indireta – art. 483 CLT; reversão de justa causa – art. 482 CLT; nulidade de pedido de demissão por coação – art. 9º CLT; e acordo – art. 484-A CLT). Redija o capítulo COMPLETO da modalidade correta em prosa jurídica fluida e argumentativa — narrativa fática, fundamentação legal, jurisprudência e pedido — sem frases curtas nem resumos.',
  },
  {
    numero: 'jornada',
    nome: 'Jornada e horas extras',
    campo: 'BLOCO_JORNADA',
    ativo: (d, c) => !!(d.escala_12x36 || d.escala_4x2 || c.jornada_horario || d.folgas_trabalhadas),
    // Escopo: a IA redige o capítulo COMPLETO de jornada e horas extras
    // (narrativa fática + fundamentação legal + jurisprudência + pedido com
    // reflexos), em prosa argumentativa articulada — não apenas a narrativa
    // fática. A descaracterização da escala (12x36/4x2), o art. 71, o adicional
    // noturno, os 10 minutos, a periculosidade e o DSR autônomo permanecem
    // DETERMINÍSTICOS no template (seções {{#flag}} próprias) — não são
    // reescritos pela IA, para preservar os precedentes verificados e as travas
    // de categoria.
    instrucao:
      'Escreva o capítulo COMPLETO de "DA JORNADA DE TRABALHO / DAS HORAS EXTRAS", argumentando o tópico por completo em prosa jurídica fluida e articulada (NÃO apenas frases ou palavras soltas): (1) narre, com base nos dados do caso, o horário e a escala efetivamente cumpridos (campos jornada_horario/escala), a prorrogação/extrapolação habitual da jornada e a ausência de contraprestação; (2) fundamente a tese de horas extras excedentes da 8ª diária e 44ª semanal (art. 59 da CLT; adicional convencional real da CCT — nunca presuma o percentual; na falta, use [adicional conforme CCT]; Súmula 85 do TST como fundamentação que amplia a base das horas extras quando a escala for 12x36, sem criar pedido próprio); (3) trate, quando relevante, a jurisprudência que ampara a tese; (4) conclua com o pedido de diferenças de horas extras, COM reflexos em DSR, aviso prévio, férias +1/3, 13º salário e FGTS +40% (mencionados de forma qualitativa, SEM R$). NÃO escreva a descaracterização da escala (12x36/4x2) como seção/pedido autônomo, o art. 71 (intervalo), o adicional noturno, os 10 minutos de descanso, a periculosidade nem o DSR autônomo — essas seções têm texto fixo próprio no template. NÃO trate de rescisão, dano moral nem enquadramento funcional.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em jornada de trabalho e horas extras. Redija o capítulo COMPLETO da jornada e das horas extras em prosa jurídica fluida e argumentativa — narrativa fática, fundamentação legal, jurisprudência e pedido com reflexos qualitativos — sem reproduzir as seções de descaracterização da escala, art. 71, adicional noturno, 10 minutos, periculosidade e DSR autônomo, que já constam do modelo.',
  },
  {
    numero: 'dano_moral',
    nome: 'Dano moral',
    campo: 'BLOCO_DANO_MORAL',
    ativo: (d, c) => !!c.tem_dano_moral,
    instrucao:
      'Escreva o capítulo COMPLETO da narrativa dos fatos do dano moral — parágrafos articulados em prosa jurídica fluida, persuasiva e COERENTE, com o contexto completo do caso (NÃO frases isoladas nem fragmentos soltos). Narre os abusos sofridos pelo reclamante (campos dano_fatos/dano_supervisor: nome do supervisor, perseguição, humilhação, desconto indevido de consignado, etc.), o contexto em que ocorreram, a habitualidade das condutas e o impacto sobre a dignidade pessoal e a honra do autor, encadeando os fatos em uma narrativa articulada e completa. NÃO escreva a fundamentação constitucional/doutrinária (art. 5º, V/X, CF; art. 186, 927, CC) — ela já consta do template antes deste bloco. NÃO trate de jornada, rescisão nem verbas. NÃO cite valores em R$.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em dano moral. Redija o capítulo COMPLETO da narrativa dos fatos concretos do dano moral, em prosa articulada, persuasiva e coerente, com o contexto completo do caso — sem a fundamentação doutrinária (já presente no template) e sem valores em R$ (calculados por código).',
  },
  {
    numero: 'enquadramento',
    nome: 'Enquadramento funcional',
    campo: 'BLOCO_ENQUADRAMENTO',
    ativo: (d) => !!(d.desvio_funcao || d.acumulo_funcao || d.gratificacao_funcao),
    instrucao:
      'Escreva o capítulo COMPLETO de enquadramento funcional, em prosa jurídica fluida, articulada e SUBSTANCIAL (NÃO frases curtas ou resumos): (1) FATOS — narre as atividades efetivamente exercidas pelo reclamante que configuram desvio, acúmulo ou gratificação de função (campos desvio_atividades/acumulo_atividades); (2) FUNDAMENTO LEGAL/NORMATIVO — fundamente o enquadramento correto com dispositivos da CLT e a multa/adicional convencional correspondente da CCT; (3) JURISPRUDÊNCIA — trate, quando relevante, a interpretação que ampara a tese; (4) PEDIDO/CONCLUSÃO — formule o requerimento do adicional/multa devida com os reflexos (DSR, aviso prévio, férias +1/3, 13º, FGTS +40%). Desenvolva cada bloco em vários parágrafos coesos. Desvio, acúmulo e gratificação são ALTERNATIVOS sobre os mesmos fatos — escolha o correto conforme os dados e NUNCA cumule desvio com acúmulo (bis in idem). NÃO trate de jornada, dano moral nem rescisão.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em desvio, acúmulo e gratificação de função. Redija o capítulo COMPLETO do enquadramento correto em prosa jurídica argumentativa — narrativa fática, fundamentação legal, jurisprudência e pedido — sem frases curtas nem resumos.',
  },
  {
    numero: 'sumula331',
    nome: 'Responsabilidade subsidiária (Súmula 331)',
    campo: 'BLOCO_SUMULA_331',
    ativo: (d) => !!d.tem_tomadora,
    instrucao:
      'Escreva o capítulo COMPLETO de responsabilidade subsidiária da 2ª reclamada (tomadora), em prosa jurídica fluida, articulada e SUBSTANCIAL (NÃO frases curtas ou resumos): (1) FATOS — narre a relação de terceirização/tomada de serviços e a inserção do reclamante na atividade-fim da tomadora; (2) FUNDAMENTO LEGAL/NORMATIVO — fundamente a responsabilidade subsidiária com a Súmula 331 do TST e os arts. 4º e 5º do Decreto-Lei 200/1967; (3) JURISPRUDÊNCIA — trate, quando relevante, a interpretação que ampara a tese; (4) PEDIDO/CONCLUSÃO — formule o requerimento de condenação subsidiária da tomadora pelos créditos deferidos. Desenvolva cada bloco em vários parágrafos coesos. USE SEMPRE "subsidiariamente"/"responsabilidade subsidiária" — nunca "solidária". NÃO trate de outros tópicos.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em terceirização e responsabilidade subsidiária (Súmula 331 do TST). Redija o capítulo COMPLETO em prosa jurídica argumentativa — narrativa fática, fundamentação legal, jurisprudência e pedido — sem frases curtas nem resumos.',
  },
  {
    numero: 'insalubridade',
    nome: 'Insalubridade / ambiente de trabalho',
    campo: 'BLOCO_INSALUBRIDADE',
    ativo: (d) => !!d.insalubridade,
    instrucao:
      'Escreva o capítulo COMPLETO de insalubridade/ambiente de trabalho, em prosa jurídica fluida, articulada e SUBSTANCIAL: (1) FATOS — narre as condições insalubres do ambiente de trabalho (campos insalubridade_descricao: odor, falta de ventilação, EPIs inadequados, etc.) e como afetavam a saúde do reclamante; (2) FUNDAMENTO LEGAL/NORMATIVO — fundamente com os arts. 189, 192 da CLT e NR-15 do MTE, explicando o grau de insalubridade aplicável; (3) JURISPRUDÊNCIA — trate a interpretação que ampara a tese; (4) PEDIDO/CONCLUSÃO — formule o requerimento do adicional de insalubridade (mínimo 10%, médio 20% ou máximo 40% do salário mínimo, conforme grau) com reflexos em DSR, aviso prévio, férias +1/3, 13º, FGTS +40%. NÃO cite valores em R$. NÃO trate de dano moral, jornada nem rescisão.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em insalubridade e saúde do trabalhador. Redija o capítulo COMPLETO da insalubridade em prosa jurídica argumentativa — narrativa fática, fundamentação legal (arts. 189/192 CLT, NR-15), jurisprudência e pedido — sem valores em R$.',
  },
  {
    numero: 'multas_convencionais',
    nome: 'Multas convencionais',
    campo: 'BLOCO_MULTAS_CONVENCIONAIS',
    ativo: (d, c) => !!(c.cct_ano || c.sindicato || d.periculosidade || d.assiduidade || d.folgas_trabalhadas || d.desvio_funcao || d.acumulo_funcao || d.dez_minutos_cct),
    instrucao: (d, c) =>
      'Escreva o capítulo COMPLETO de "DAS MULTAS CONVENCIONAIS", argumentando por completo a aplicação da multa convencional em prosa jurídica fluida e articulada (NÃO apenas o parágrafo de abertura nem uma frase solta): fundamente por que o descumprimento das obrigações convencionais pela reclamada gera a penalidade prevista na Convenção Coletiva de Trabalho da categoria' +
      (c.cct_ano ? ` (vigência ${c.cct_ano} e anteriores)` : '') +
      (c.cct_clausula_multa ? `, nos termos da cláusula ${c.cct_clausula_multa} da referida convenção` : ', nos termos da cláusula de penalidade da referida convenção') +
      '. Desenvolva o argumento com contexto completo (natureza da multa convencional, função sancionatória e protetiva da CCT, irrelevância da culpa para a incidência da penalidade), em parágrafos coesos. Encerre com a transição que introduz a lista de infrações (ex.: "...a seguir elencadas:"). NÃO escreva a lista de infrações (ela já está no template). NÃO cite valores em R$.',
    promptPadrao:
      'Você é advogado(a) trabalhista especialista em direito coletivo e multas convencionais. Redija o capítulo COMPLETO de fundamentação das multas convencionais em prosa jurídica argumentativa e coerente, sem valores em R$ e sem reproduzir a lista de infrações (que já consta do template).',
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

// Formata as referências mais semelhantes (diferencial de cada modelo) como
// bloco de orientação para a IA redatora — pontos PARTICULARES de casos
// parecidos, sem reproduzir o texto-padrão comum a toda petição.
function resumoReferencias(referencias) {
  const refs = (referencias || []).filter((r) => r && (r.diferencial || r.conteudo) && String(r.diferencial || r.conteudo).trim());
  if (!refs.length) return '(nenhuma referência semelhante disponível — siga apenas os dispositivos legais, Súmulas e a CCT acima.)';
  const linhas = refs.map((r, i) => `--- Referência ${i + 1}${r.titulo ? ` (${r.titulo})` : ''} ---\n${String(r.diferencial || r.conteudo || '').trim()}`);
  return [
    'CASOS SEMELHANTES NA BASE (orientação — use os pontos PARTICULARES abaixo como inspiração para as teses/capítulos deste tipo de caso; priorize a PRIMEIRA referência, mais semelhante; só inclua o que tiver suporte no relato da entrevista; o restante segue o modelo padrão):',
    linhas.join('\n\n'),
  ].join('\n');
}

// Contexto COMPARTILHADO da análise única. Fica no prompt da chamada —
// prefixo estável, pronto para prompt caching quando o provedor/SDK
// expuser esse controle (hoje reenviado por chamada).
export function montarContextoCompartilhado({ caso, calculos, dadosCct, blocosAtivos, referencias = [] }) {
  return [
    'CONTEXTO COMPLETO DO CASO (leia tudo; você escreverá TODOS os capítulos ativos em uma única resposta JSON).',
    BLOCO_ENGENHARIA_JURIDICA,
    BLOCO_REGRAS_QUALIDADE,
    BLOCO_MATRIZ_TOPICOS,
    blocoRegrasCriticas({ municipios: municipiosDoCaso(caso) }),
    '',
    'REGRAS DE SEGURANÇA (obrigatórias):',
    '- Argumente SOMENTE sobre fatos presentes no caso. Se faltar um fato essencial, escreva [CONFIRMAR: ...] em vez de inventar.',
    '- PROIBIÇÃO DE CÁLCULO FINAL (MATEMÁTICA): VOCÊ ESTÁ ESTRITAMENTE PROIBIDO DE CALCULAR O VALOR ESTIMATIVO FINAL DA CAUSA. Ao listar o Rol de Pedidos, escreva detalhadamente os valores do "Principal" e seus "Reflexos" para cada verba individual (quando solicitado), mas o fechamento matemático e a soma total são injetados programaticamente pelo backend. Não escreva a frase "Dá-se à causa o valor de...", não some os itens, não escreva "Pede deferimento", a data do fecho nem a assinatura.',
    '- NÃO cite valores monetários (R$) nos capítulos nem faça aritmética. Todos os valores (rescisão, aviso prévio, 13º, férias, FGTS+multa, dano moral, honorários) são calculados por código e figuram APENAS no rol de pedidos. Mencione os reflexos (DSR, aviso prévio, férias +1/3, 13º, FGTS +40%) de forma qualitativa, sem números. Qualquer "R$ ..." no seu texto será removido pela pós-edição — não os inclua.',
    '- VEDAÇÃO A PLACEHOLDERS: NUNCA retorne blocos contendo lacunas, espaços em branco ou placeholders como "[A PREENCHER]", "[INSERIR TEXTO]" ou "[A COMPLETAR]". Se um dado faltar, redija o capítulo sem essa informação ou use a forma [CONFIRMAR: ...] (marcador de revisão, não lacuna vazia).',
    '- CAUSA DE PEDIR ALINHADA: No tópico da Competência, utilize EXCLUSIVAMENTE o endereço de prestação de serviços da Tomadora (local_prestacao), justificando o foro adequado. NUNCA utilize o endereço residencial do autor para este fim.',
    '- Cite SOMENTE as cláusulas listadas em CLÁUSULAS DA CCT. Nunca invente número de cláusula.',
    '- Escreva APENAS os capítulos solicitados abaixo. NÃO escreva endereçamento, qualificação das partes, valor da causa, honorários, data ou fecho — o sistema gera isso.',
    '- ESTRUTURA FIXA — quatro blocos legais por capítulo, nesta ordem: (1) FATOS — narre o que ocorreu no caso concreto em prosa articulada (sem bullets mecânicos); (2) FUNDAMENTO LEGAL/NORMATIVO — cite dispositivos da CLT, Súmulas do TST e cláusulas da CCT integrados ao texto (não como lista solta); (3) JURISPRUDÊNCIA — trate, quando relevante, a interpretação que ampara a tese; (4) PEDIDO/CONCLUSÃO — formule o requerimento com os reflexos (DSR, aviso prévio, férias+1/3, 13º, FGTS+40%).',
    '- REDAÇÃO NATURAL: escreva em parágrafos jurídicos coesos e fluídos, como um advogado experiente em uma petição — NÃO use o padrão rígido "fato → artigo → Súmula → impugnação → pedido" repetido mecanicamente em cada capítulo. Varie a construção das frases, encadeie os argumentos e evite listas/colchetes e linguagem robótica; o texto deve soar natural, não enlatado. Cada capítulo deve ser SUBSTANCIAL e COMPLETO: narrativa fática desenvolvida, fundamentação legal ampla e jurisprudência articulada — NÃO entregue resumos, frases curtas, bullet points soltos nem um único parágrafo por capítulo; desenvolva cada um dos quatro blocos (fatos, fundamento, jurisprudência, pedido) em vários parágrafos.',
    '- Mantenha a impugnação da defesa (Súmula 338) e os reflexos quando cabíveis, mas inseridos organicamente no bloco de pedido, não como etapa idêntica obrigatória em todos os capítulos.',
    '- Cada capítulo NÃO deve invadir o tópico de outro. Respeite o escopo indicado em cada um.',
    '- CONCORDÂNCIA DE GÊNERO (STRICT): o campo recl_genero indica "M" (masculino) ou "F" (feminino). Aplique concordância PERFEITA em TODO o texto. Se MASCULINO, é PROIBIDO o uso de "a reclamante", "a obreira", "foi contratada", "foi prejudicada", "rendê-la" ou qualquer flexão feminina — use "o reclamante", "foi contratado", "foi prejudicado", "rendê-lo". Se FEMININO, o inverso. Use "reclamante" como substantivo (nunca "autor") e flexione adjetivos e particípios adequadamente. Não troque o gênero de "reclamada" (a empresa). Verifique todo o texto gerado antes de entregar o output.',
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
    resumoReferencias(referencias),
    '',
    `CAPÍTULOS ATIVOS NESTA PEÇA: ${blocosAtivos.join(', ')}.`,
  ].join('\n');
}

// Orquestrador: acende os capítulos conforme as flags (determinístico),
// faz UMA ÚNICA chamada à IA devolvendo TODOS os capítulos ativos de
// uma vez (JSON) e devolve os blocos por campo do template.
export async function redigirTesesIA({ caso, calculos, dadosCct, dados, referencias = [], onTool } = {}) {
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
  const contexto = montarContextoCompartilhado({ caso: c, calculos: calculos || [], dadosCct, blocosAtivos, referencias });

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