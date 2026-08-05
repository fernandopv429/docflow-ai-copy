// Redação por IA dos capítulos da petição — porta backend de
// src/lib/trabalhista/redacaoTeses.js + módulos de contexto. Recebe
// `invokeLLM` por injeção (backend: base44.asServiceRole.integrations.Core.InvokeLLM)
// e `configs` (EspecialistaConfig) já carregados pelo orquestrador.

import { formatBRL, temDanoMoralConcreto } from './mathUtils.js';

const BLOCO_ENGENHARIA_JURIDICA = `
DIRETRIZES DE ENGENHARIA JURÍDICA (obrigatórias):
B) TESE RESCISÓRIA — selecione UMA conforme o relato:
- Dispensa sem justa causa: saldo de salário, aviso prévio indenizado (Lei 12.506/11), férias + 1/3, 13º proporcional e FGTS + 40%, sem capítulo de reversão/rescisão indireta.
- Pedido de demissão sob coação/ameaça: incluir "DA ANULAÇÃO DO PEDIDO DE DEMISSÃO E CONVOLAÇÃO EM DISPENSA IMOTIVADA" (art. 171, II, CC c/c art. 9º CLT), com pedido expresso de nulidade.
- Justa causa injusta: incluir "DA REVERSÃO DA DISPENSA POR JUSTA CAUSA" (art. 482 CLT; ônus do empregador; ausência de falta grave e desproporcionalidade da punição).
- Rescisão indireta: incluir "DA RESCISÃO INDIRETA DO CONTRATO DE TRABALHO" (art. 483, "b" e "d", CLT), com rol das faltas graves do empregador; a multa do art. 477 fica subsidiária.
C) ENQUADRAMENTO FUNCIONAL (nunca cumular teses sobre os mesmos fatos):
- Vigilante executando prevenção de perdas, conferência de cargas ou controle de validade de produtos → SOMENTE DESVIO DE FUNÇÃO (multa convencional de 50% por mês — cláusula 64ª da CCT de vigilância).
- Vigilante conduzindo veículo/moto (motoronda) → GRATIFICAÇÃO DE FUNÇÃO de 10% sobre o salário base (cláusula 3ª).
- Porteiro/controlador executando rondas de vigilante → ACÚMULO DE FUNÇÃO de 20% sobre o salário.
D) JORNADA E DANO MORAL:
- Trate exclusivamente da escala relatada. Em 12x36, aborde a extensão habitual, a supressão do intervalo intrajornada (art. 71 CLT), os minutos de troca de uniforme antes/depois e o labor em folgas (FTS).
- Para vigilantes, incluir a tese dos 10 minutos de descanso sentado a cada hora trabalhada (cláusulas 33ª/34ª da CCT).
- Dano moral: manter a fundamentação doutrinária padrão e INCORPORAR a narrativa concreta dos abusos. Valor: exatamente 10x o último salário do reclamante.
E) CÁLCULO E ROL DE PEDIDOS: valores determinísticos por código — não recalcular.
G) ENTREGA: concordância de gênero conforme o reclamante; "seu advogado" sempre masculino.`;

const BLOCO_REGRAS_QUALIDADE = `
REGRAS DE QUALIDADE NA REDAÇÃO DOS CAPÍTULOS:
- COMPETÊNCIA / LOCAL DE PRESTAÇÃO: refira-se ao endereço da prestação (reclamada/tomadora), NUNCA ao residencial do reclamante. Grafia exata dos dados (inclusive km).
- DANO MORAL: narrativa fluida e encadeada; PROIBIDO frases soltas/fragmentadas.
- MULTAS CONVENCIONAIS: NÚMERO exato das cláusulas e PERCENTUAL conforme a CCT fornecida; PROIBIDO inventar — sem CCT, use [cláusula/percentual conforme CCT].
- SEM DUPLICIDADE ENTRE CAPÍTULOS: cada verba/tese tratada UMA vez.
- HONORÁRIOS: art. 791-A da CLT; NUNCA Súmula 425 do TST.`;

const BLOCO_MATRIZ_TOPICOS = `
MATRIZ DE TÓPICOS — REGRAS DE INCLUSÃO, EXCLUSÃO E BIS IN IDEM:
JORNADA E HORAS EXTRAS: excedentes da 8ª diária/44ª semanal com adicional convencional real da CCT; descaracterização do 12x36 (Súmula 85) é fundamentação, não pedido; art. 71 com reflexos; noturno só se a jornada abranger 22h-5h; minutos de troca (vigilância); DSR autônomo só com causa própria; folgas/feriados 100% (Súmula 444).
VIGILÂNCIA: 10 minutos de descanso (cumulativo c/ art. 71); periculosidade nas HE (armado — Súmula 132 I); VT/VA nas folgas.
ENQUADRAMENTO: desvio (prevenção de perdas), gratificação (condutor), acúmulo (porteiro) — alternativos, nunca cumular.
OUTROS: integração de valores por fora; assiduidade só se prometido; tomadora SUBSIDIÁRIA (Súmula 331), nunca solidária; avos conforme meses trabalhados.`;

const MUNICIPIOS_TRT2 = [
  'são paulo', 'itapecerica da serra', 'embu', 'embu das artes', 'embu-guaçu', 'taboão da serra',
  'osasco', 'carapicuíba', 'cotia', 'barueri', 'jandira', 'itapevi', 'guarulhos', 'santo andré',
  'são bernardo do campo', 'são caetano do sul', 'diadema', 'mauá', 'ribeirão pires',
  'rio grande da serra', 'mogi das cruzes', 'suzano', 'poá', 'itaquaquecetuba', 'ferraz de vasconcelos',
  'arujá', 'santa isabel', 'caieiras', 'franco da rocha', 'francisco morato', 'mairiporã',
  'santana de parnaíba', 'pirapora do bom jesus', 'juquitiba', 'são lourenço da serra',
  'santos', 'são vicente', 'guarujá', 'cubatão', 'praia grande', 'itanhaém', 'peruíbe',
  'mongaguá', 'bertioga', 'caraguatatuba', 'são sebastião', 'ubatuba', 'ilhabela',
];

function regiaoTrtPorMunicipio(municipio) {
  const m = (municipio || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const achou = MUNICIPIOS_TRT2.some((nome) => m.includes(nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
  return achou ? '2ª Região (TRT-2)' : null;
}

function blocoRegrasCriticas({ municipios = [] } = {}) {
  const trt2 = municipios.filter((m) => regiaoTrtPorMunicipio(m));
  const orientacaoTrt = trt2.length
    ? `O local de prestação (${trt2.join(', ')}) pertence ao TRT da 2ª Região. Enderece a "AO JUÍZO DA VARA DO TRABALHO DE ${trt2[0].toUpperCase()} – SEGUNDA REGIÃO". NUNCA use TRT da 15ª Região.`
    : 'Confirme o TRT pelo município de prestação: Grande São Paulo/Baixada Santista/Litoral = 2ª Região; interior/Campinas = 15ª Região.';
  return `
REGRAS CRÍTICAS (erros já cometidos — NÃO repita):
1. COMPETÊNCIA / TRT: ${orientacaoTrt}
2. ESCALA: use EXCLUSIVAMENTE a escala relatada. PROIBIDO criar tópicos sobre escalas não trabalhadas.
3. DESVIO × ACÚMULO: alternativos e excludentes sobre os mesmos fatos — escolha UM só.
4. HONORÁRIOS: fora do array de saída (calculados à parte pelo sistema).
5. VALORES ESTIMADOS: proporcionais por item; PROIBIDO valores redondos genéricos.
6. VALOR DA CAUSA, FECHO E ASSINATURA são determinísticos — não os escreva.`;
}

function sanitizarValoresIA(texto) {
  if (!texto) return texto;
  return texto
    .replace(/R\$\s*\d[\d.\s]*,\d{2}/gi, '')
    .replace(/R\$\s*\d[\d.,]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

const flag = (v) => !!v;
const soDigitos = (s) => (s || '').replace(/\D/g, '');

export function computeFlags(caso = {}, attrs = {}, dadosReceita = []) {
  const d = {};
  const receita = (cnpj) => (dadosReceita || []).find((r) => r && !r.erro && soDigitos(r.cnpj) === soDigitos(cnpj));
  const r2 = receita(caso.recl2_cnpj);
  const tipo = caso.tipo_dispensa || attrs.tipo_dispensa || 'sem_justa_causa';
  const escalaTxt = `${caso.escala || ''} ${caso.jornada_horario || ''}`;
  const ehVigilante = /vigilante|vigil/i.test(caso.funcao || attrs.funcao || '');
  const mesmoFatoDesvio =
    caso.tem_desvio && caso.acumulo_atividades && caso.desvio_atividades &&
    String(caso.acumulo_atividades).toLowerCase() === String(caso.desvio_atividades).toLowerCase();

  d.tem_tomadora = flag(caso.recl2_nome || r2 || attrs.tem_tomadora);
  d.sem_justa_causa = tipo === 'sem_justa_causa';
  d.rescisao_indireta = tipo === 'rescisao_indireta';
  d.coacao_demissao = tipo === 'nulidade_pedido_demissao';
  d.reversao_justa_causa = tipo === 'reversao_justa_causa';
  d.tem_capitulo_rescisao = ['rescisao_indireta', 'nulidade_pedido_demissao', 'reversao_justa_causa'].includes(tipo);
  d.acumulo_funcao = flag(caso.tem_acumulo && caso.acumulo_atividades && !mesmoFatoDesvio);
  d.desvio_funcao = flag(caso.tem_desvio);
  d.gratificacao_funcao = flag(caso.tem_gratificacao);
  d.escala_12x36 = /12\s*x\s*36/i.test(escalaTxt);
  d.escala_4x2 = /\b(4\s*x\s*2|6\s*x\s*2)\b/i.test(escalaTxt);
  d.adicional_noturno = flag(caso.tem_adic_noturno);
  d.integracao_por_fora = flag(caso.tem_integracao_por_fora);
  d.periculosidade = flag(caso.tem_periculosidade) || ehVigilante;
  d.dez_minutos_cct = flag(caso.tem_dez_min_cct) || ehVigilante;
  d.salarios_em_aberto = flag(caso.tem_salarios_aberto);
  d.assiduidade = flag(caso.tem_assiduidade);
  d.vale_transporte = flag(caso.tem_vale_transporte);
  d.auxilio_alimentacao = flag(caso.tem_auxilio_alimentacao);
  d.doenca_ocupacional = flag(caso.tem_doenca);
  d.insalubridade = flag(caso.tem_insalubridade);
  d.folgas_trabalhadas = flag(caso.tem_ft || caso.val_ft || caso.ft_qtd_media);
  d.tem_ferias_vencidas = flag(caso.tem_ferias_vencidas);
  d.cct_ano = caso.cct_ano || '';
  d.sindicato = caso.sindicato || '';
  return d;
}

export const ESPECIALISTAS = [
  { numero: 'espinha', nome: 'Espinha da rescisão', campo: 'BLOCO_ESPINHA_RESCISAO', ativo: () => true,
    instrucao: 'Escreva o capítulo COMPLETO da modalidade de rescisão aplicável (conforme tipo_dispensa), em prosa jurídica fluida e SUBSTANCIAL: (1) FATOS — narre a situação que configura a modalidade; (2) FUNDAMENTO LEGAL/NORMATIVO — dispositivos da CLT (art. 482, 483, 484-A, 165 etc.); (3) JURISPRUDÊNCIA — quando relevante; (4) PEDIDO/CONCLUSÃO — requerimento com os reflexos cabíveis. NÃO escreva jornada, dano moral nem verbas calculadas.',
    promptPadrao: 'Você é advogado(a) trabalhista especialista em teses rescisórias. Redija o capítulo COMPLETO em prosa jurídica fluida e argumentativa.' },
  { numero: 'jornada', nome: 'Jornada e horas extras', campo: 'BLOCO_JORNADA', ativo: (d, c) => !!(d.escala_12x36 || d.escala_4x2 || c.jornada_horario || d.folgas_trabalhadas),
    instrucao: 'Escreva o capítulo COMPLETO de "DA JORNADA DE TRABALHO / DAS HORAS EXTRAS": (1) narre horário/escala efetivos e a prorrogação habitual sem contraprestação; (2) fundamente horas extras excedentes da 8ª diária/44ª semanal (art. 59 CLT; adicional convencional real da CCT — nunca presuma; na falta use [adicional conforme CCT]; Súmula 85); (3) jurisprudência; (4) pedido de diferenças de horas extras COM reflexos (DSR, aviso, férias+1/3, 13º, FGTS+40%) de forma qualitativa, SEM R$. NÃO escreva descaracterização da escala, art. 71, noturno, 10 minutos, periculosidade nem DSR autônomo (seções fixas do template).',
    promptPadrao: 'Você é advogado(a) trabalhista especialista em jornada e horas extras. Redija o capítulo COMPLETO em prosa argumentativa.' },
  { numero: 'dano_moral', nome: 'Dano moral', campo: 'BLOCO_DANO_MORAL', ativo: (d, c) => temDanoMoralConcreto(c),
    instrucao: 'Escreva a narrativa COMPLETA dos fatos do dano moral em parágrafos articulados e coerentes. Conecte TODOS os abusos concretos (desvio/acúmulo exaustivo, supressão de intervalos, pagamentos por fora, descontos indevidos, perseguição/humilhação), o contexto, a habitualidade e o impacto sobre a dignidade do autor. NÃO escreva a fundamentação constitucional/doutrinária (já no template). NÃO trate jornada/rescisão/verbas. NÃO cite R$.',
    promptPadrao: 'Você é advogado(a) trabalhista especialista em dano moral. Redija a narrativa concreta em prosa articulada, sem fundamentação doutrinária nem valores.' },
  { numero: 'enquadramento', nome: 'Enquadramento funcional', campo: 'BLOCO_ENQUADRAMENTO', ativo: (d) => !!(d.desvio_funcao || d.acumulo_funcao || d.gratificacao_funcao),
    instrucao: 'Escreva o capítulo COMPLETO de enquadramento funcional em prosa SUBSTANCIAL: (1) FATOS — atividades que configuram desvio/acúmulo/gratificação; (2) FUNDAMENTO — CLT e multa/adicional convencional da CCT; (3) JURISPRUDÊNCIA; (4) PEDIDO — adicional/multa com reflexos. Desvio/acúmulo/gratificação são ALTERNATIVOS — nunca cumule desvio com acúmulo (bis in idem). NÃO trate jornada/dano/rescisão.',
    promptPadrao: 'Você é advogado(a) trabalhista especialista em desvio, acúmulo e gratificação. Redija o capítulo COMPLETO em prosa argumentativa.' },
  { numero: 'sumula331', nome: 'Responsabilidade subsidiária (Súmula 331)', campo: 'BLOCO_SUMULA_331', ativo: (d) => !!d.tem_tomadora,
    instrucao: 'Escreva o capítulo COMPLETO de responsabilidade subsidiária da 2ª reclamada (tomadora): (1) FATOS — terceirização e inserção na atividade-fim; (2) FUNDAMENTO — Súmula 331 TST e arts. 4º/5º DL 200/1967; (3) JURISPRUDÊNCIA; (4) PEDIDO — condenação subsidiária. USE SEMPRE "subsidiariamente" — nunca "solidária". NÃO trate outros tópicos.',
    promptPadrao: 'Você é advogado(a) trabalhista especialista em terceirização e Súmula 331. Redija o capítulo COMPLETO em prosa argumentativa.' },
  { numero: 'insalubridade', nome: 'Insalubridade / ambiente de trabalho', campo: 'BLOCO_INSALUBRIDADE', ativo: (d) => !!d.insalubridade,
    instrucao: 'Escreva o capítulo COMPLETO de insalubridade: (1) FATOS — condições insalubres e impacto na saúde; (2) FUNDAMENTO — arts. 189/192 CLT e NR-15; (3) JURISPRUDÊNCIA; (4) PEDIDO — adicional (10/20/40% do salário mínimo) com reflexos. NÃO cite R$. NÃO trate dano moral/jornada/rescisão.',
    promptPadrao: 'Você é advogado(a) trabalhista especialista em insalubridade. Redija o capítulo COMPLETO em prosa argumentativa.' },
  { numero: 'multas_convencionais', nome: 'Multas convencionais', campo: 'BLOCO_MULTAS_CONVENCIONAIS', ativo: (d, c) => !!(c.cct_ano || c.sindicato || d.periculosidade || d.assiduidade || d.folgas_trabalhadas || d.desvio_funcao || d.acumulo_funcao || d.dez_minutos_cct),
    instrucao: (d, c) =>
      'Escreva o capítulo COMPLETO de "DAS MULTAS CONVENCIONAIS", fundamentando a aplicação da multa convencional por descumprimento das obrigações da CCT' +
      (c.cct_ano ? ` (vigência ${c.cct_ano} e anteriores)` : '') +
      (c.cct_clausula_multa ? `, nos termos da cláusula ${c.cct_clausula_multa}` : ', nos termos da cláusula de penalidade') +
      '. Desenvolva em parágrafos coesos (natureza sancionatória/protetiva, irrelevância da culpa). Encerre introduzindo a lista de infrações ("...a seguir elencadas:"). NÃO escreva a lista (já no template). NÃO cite R$.',
    promptPadrao: 'Você é advogado(a) trabalhista especialista em direito coletivo e multas convencionais. Redija o capítulo COMPLETO sem R$ e sem a lista de infrações.' },
];

const MODELOS_VALIDOS = { claude_opus_4_6: 'claude_opus_4_6', claude_sonnet_4_6: 'claude_sonnet_4_6', gemini_3_1_pro: 'gemini_3_1_pro' };
function modeloUnico(configs) {
  for (const cfg of configs || []) {
    if (MODELOS_VALIDOS[cfg?.modelo_ia]) return MODELOS_VALIDOS[cfg.modelo_ia];
  }
  return 'claude_sonnet_4_6';
}

function resumoCalculos(calculos) {
  const linhas = (calculos || []).filter((c) => c.valor != null).map((c) => `- ${c.item}: ${formatBRL(c.valor)} (${c.memoria})`);
  return linhas.length ? linhas.join('\n') : '(sem valores calculados disponíveis)';
}

function resumoCct(dadosCct) {
  const cl = dadosCct?.clausulas || [];
  if (!cl.length) return '(nenhuma cláusula de CCT disponível — NÃO cite número de cláusula; use apenas dispositivos legais e Súmulas.)';
  return cl.slice(0, 12).map((c) => {
    const ref = c.clausula_ref || '(cláusula)';
    const tit = c.titulo || '';
    const corpo = (c.ementa || c.texto || c.conteudo || '').replace(/\s+/g, ' ').slice(0, 240);
    return `- ${ref} — ${tit}: ${corpo}`;
  }).join('\n');
}

const CAMPOS_CASO = ['recl_nome', 'recl_genero', 'funcao', 'tipo_dispensa', 'data_admissao', 'data_rescisao', 'salario', 'maior_remuneracao', 'escala', 'jornada_horario', 'intervalo_usufruido', 'prorrogacao_jornada', 'ft_qtd_media', 'acumulo_atividades', 'desvio_atividades', 'dano_fatos', 'dano_supervisor', 'recl1_nome', 'recl2_nome', 'sindicato', 'cct_ano', 'comarca_uf', 'local_prestacao'];
function resumoCaso(caso) {
  const obj = {};
  for (const k of CAMPOS_CASO) if (caso[k] != null && caso[k] !== '') obj[k] = caso[k];
  return JSON.stringify(obj, null, 2);
}

function municipiosDoCaso(caso) {
  const out = [];
  if (caso.comarca) out.push(caso.comarca);
  const m = /([A-Za-zÀ-ÿ\s'.-]+?)\s*[-/]\s*[A-Z]{2}\b/.exec(caso.local_prestacao || '');
  if (m) out.push(m[1].trim());
  return out;
}

function montarContextoCompartilhado({ caso, calculos, dadosCct, blocosAtivos }) {
  return [
    'CONTEXTO COMPLETO DO CASO (leia tudo; você escreverá TODOS os capítulos ativos em uma única resposta JSON).',
    BLOCO_ENGENHARIA_JURIDICA,
    BLOCO_REGRAS_QUALIDADE,
    BLOCO_MATRIZ_TOPICOS,
    blocoRegrasCriticas({ municipios: municipiosDoCaso(caso) }),
    '',
    'REGRAS DE SEGURANÇA (obrigatórias):',
    '- Argumente SOMENTE sobre fatos presentes no caso. Se faltar essencial, use [CONFIRMAR: ...].',
    '- PROIBIÇÃO DE CÁLCULO FINAL: não calcule nem some o valor da causa; não escreva "Dá-se à causa o valor de...", "Pede deferimento", data nem assinatura — tudo determinístico.',
    '- NÃO cite R$ nos capítulos. Valores são calculados por código e figuram APENAS no rol de pedidos. Mencione reflexos de forma qualitativa.',
    '- VEDAÇÃO A PLACEHOLDERS: nunca lacunas "[A PREENCHER]"; se faltar dado, use [CONFIRMAR: ...].',
    '- CAUSA DE PEDIR ALINHADA: use EXCLUSIVAMENTE o endereço de prestação da Tomadora (local_prestacao) na Competência; NUNCA o residencial do autor.',
    '- Cite SOMENTE cláusulas listadas em CLÁUSULAS DA CCT. Nunca invente número.',
    '- Escreva APENAS os capítulos solicitados. NÃO escreva endereçamento, qualificação, valor da causa, honorários, data ou fecho.',
    '- ESTRUTURA FIXA — quatro blocos por capítulo: (1) FATOS; (2) FUNDAMENTO LEGAL/NORMATIVO; (3) JURISPRUDÊNCIA; (4) PEDIDO/CONCLUSÃO.',
    '- REDAÇÃO NATURAL: parágrafos jurídicos coesos e fluídos, não enlatados; cada capítulo SUBSTANCIAL e COMPLETO.',
    '- CONCORDÂNCIA DE GÊNERO (STRICT): recl_genero "M" ou "F" — concordância PERFEITA em todo o texto. M → "o reclamante" (proibido feminino); F → o inverso. "reclamada" (empresa) nunca troca. "seu advogado" sempre masculino.',
    '',
    'DADOS DO CASO:', resumoCaso(caso), '',
    'VALORES CALCULADOS (determinísticos — USE ESTES, NÃO RECALCULE):', resumoCalculos(calculos), '',
    'CLÁUSULAS DA CCT (grounding — só cite estas):', resumoCct(dadosCct), '',
    `CAPÍTULOS ATIVOS NESTA PEÇA: ${blocosAtivos.join(', ')}.`,
  ].join('\n');
}

export async function redigirTesesIA({ caso, calculos, dadosCct, dados, configs = [], invokeLLM }) {
  const ativos = ESPECIALISTAS.filter((e) => { try { return e.ativo(dados, caso); } catch { return false; } });
  if (!ativos.length) return { blocos: {}, especialistasUsados: [] };

  const cfgPorNumero = new Map((configs || []).map((c) => [String(c.numero), c]));
  const blocosAtivos = ativos.map((e) => e.nome);
  const contexto = montarContextoCompartilhado({ caso, calculos, dadosCct, blocosAtivos });

  const properties = {};
  const tarefas = ativos.map((e) => {
    const cfg = cfgPorNumero.get(e.numero);
    const promptSistema = cfg?.prompt_sistema || e.promptPadrao;
    const instrucao = typeof e.instrucao === 'function' ? e.instrucao(dados, caso) : e.instrucao;
    properties[e.campo] = { type: 'string', description: `Capítulo: ${e.nome}. ${instrucao} Papel: ${promptSistema}` };
    return `### ${e.campo} — ${e.nome}\nPapel: ${promptSistema}\nTarefa: ${instrucao}`;
  });

  const multasAtivo = ativos.some((e) => e.numero === 'multas_convencionais');
  if (multasAtivo) {
    properties.PEDIDOS_MULTAS = {
      type: 'array', items: { type: 'string' },
      description: 'Lista de violações convencionais específicas, uma frase curta por item terminando em ";". Cite o número da cláusula APENAS quando grounded em CLÁUSULAS DA CCT. Sem cláusula, descreva a violação legal. 3 a 10 itens. Sem R$.',
    };
    tarefas.push('### PEDIDOS_MULTAS — Lista individualizada de multas convencionais\nPapel: Especialista em direito coletivo.\nTarefa: Liste em array de strings as violações convencionais específicas deste caso (cite cláusula só quando grounded; sem cláusula, descreva sem número). Adapte às teses ativas.');
  }

  const prompt = [
    contexto, '',
    '=============================',
    'TAREFA ÚNICA: escreva TODOS os capítulos abaixo em UMA resposta JSON.',
    'Cada chave do JSON é o campo do template; o valor é o texto do capítulo em português jurídico, sem rótulo e sem comentários.',
    'Não inclua texto fora do JSON. Campos sem informação: string vazia.',
    '', 'CAPÍTULOS A REDIGIR (escreva todos):', tarefas.join('\n\n'),
  ].join('\n');

  const model = modeloUnico(configs);

  let r;
  try {
    r = await invokeLLM({ prompt, model, response_json_schema: { type: 'object', properties } });
  } catch (e) {
    // sem retry no backend — a peça segue com fallback determinístico do template
    return { blocos: {}, especialistasUsados: blocosAtivos, erro: e?.message || 'falha InvokeLLM' };
  }
  let obj = (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};
  // InvokeLLM no backend envelopa o resultado em { response: ... }, às vezes
  // como string JSON, às vezes como objeto. Desembrulha para chegar aos campos.
  if (obj.response != null) {
    if (typeof obj.response === 'string') {
      try { obj = JSON.parse(obj.response); } catch (e) { /* mantém obj */ }
    } else if (typeof obj.response === 'object' && !Array.isArray(obj.response)) {
      obj = obj.response;
    }
  }
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (e) { obj = {}; }
  }

  const blocos = {};
  for (const e of ativos) {
    const texto = typeof obj[e.campo] === 'string' ? obj[e.campo].trim() : '';
    if (texto) blocos[e.campo] = sanitizarValoresIA(texto);
  }
  if (multasAtivo && Array.isArray(obj.PEDIDOS_MULTAS)) {
    const lista = obj.PEDIDOS_MULTAS.map((s) => (typeof s === 'string' ? sanitizarValoresIA(s.trim()) : '')).filter(Boolean);
    if (lista.length) blocos.pedidos_multas = lista;
  }
  return { blocos, especialistasUsados: blocosAtivos, objKeys: Object.keys(obj || {}), objAmostra: JSON.stringify(obj || {}).slice(0, 500) };
}