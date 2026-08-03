import { formatBRL, round2, brlComExtenso } from './mathUtils';

// ============================================================
// FONTE ÚNICA DE DADOS DA PETIÇÃO
// Alinhado ao MODELO-MESTRE (.docx docxtemplater) do escritório.
// Alimenta o PREVIEW e a EXPORTAÇÃO (docxtemplater). A IA NÃO gera
// o documento: valores são determinísticos (mathUtils); partes/contrato
// vêm do parser; textos livres do caso são poucos (dano moral etc.);
// as FLAGS ligam/desligam as seções {{#flag}}...{{/flag}} do .docx.
// ============================================================

// Rótulo do item calculado (mathUtils) -> campo {{VALOR_*}} do template
const CALC_CAMPO = {
  'Aviso prévio indenizado': 'VALOR_AVISO_PREVIO',
  'Saldo de salário': 'VALOR_SALDO_SALARIO',
  'Multa do art. 467 da CLT': 'VALOR_MULTA_467',
  '13º proporcional': 'VALOR_13',
  'Férias proporcionais + 1/3': 'VALOR_FERIAS',
  'FGTS do período (8%)': 'VALOR_FGTS',
  'Multa de 40% do FGTS': 'VALOR_MULTA_40',
  'Multa de 20% do FGTS (acordo)': 'VALOR_MULTA_40',
  'Dano moral (10x remuneração)': 'VALOR_DANO_MORAL_10X',
  'Folgas trabalhadas (100%)': 'VALOR_FT',
  'Reflexo DSR sobre FT (1/6)': 'VALOR_DSR',
  'Acúmulo de função (20%)': 'VALOR_ACUMULO',
  'Bonificação de assiduidade (diferença)': 'VALOR_ASSIDUIDADE',
  'Integração de valores por fora': 'VALOR_INTEGRACAO',
  'Auxílio-alimentação nas folgas': 'VALOR_AUX_ALIM_TOTAL',
  'Vale-transporte nas folgas': 'VALOR_VT_TOTAL',
  'Gratificação de função (10%)': 'VALOR_GRATIFICACAO',
  'Gratificação/bônus de função': 'VALOR_GRATIFICACAO',
  'Desvio de função (50%)': 'VALOR_DESVIO',
  'Multa do art. 477 da CLT': 'VALOR_MULTA_477',
  'Salários em aberto': 'VALOR_SALARIOS_ABERTO',
  'Honorários advocatícios (15%)': 'VALOR_HONORARIOS',
};

// Contrato de tags do .docx (documentação viva).
export const CAMPOS_TEMPLATE = [
  'VARA_CIDADE_REGIAO', 'RITO',
  'RECL_NOME', 'RECL_NACIONALIDADE', 'RECL_ESTADO_CIVIL', 'RECL_FUNCAO', 'RECL_RG', 'RECL_CPF',
  'RECL_PIS', 'RECL_CTPS', 'RECL_SERIE', 'RECL_NASCIMENTO', 'RECL_FILIACAO', 'RECL_ENDERECO', 'RECL_EMAIL',
  'RECLAMADA1_RAZAO', 'RECLAMADA1_CNPJ', 'RECLAMADA1_ENDERECO',
  'RECLAMADA2_RAZAO', 'RECLAMADA2_CNPJ', 'RECLAMADA2_ENDERECO',
  'LOCAL_PRESTACAO_ENDERECO', 'DATA_ADMISSAO', 'DATA_RESCISAO', 'SALARIO',
  'MODO_RESCISAO', 'MOTIVO_SAIDA_RESUMIDO', 'DANO_MORAL_FATO_ESPECIFICO',
  'JORNADA_HORARIOS', 'ESCALA', 'INTERVALO_USUFRUIDO', 'PRORROGACAO_JORNADA', 'FOLGAS_LABORADAS_MES',
  'ACUMULO_ATIVIDADES', 'ASSIDUIDADE_PROMETIDO', 'ASSIDUIDADE_PAGO', 'ASSIDUIDADE_DIFERENCA',
  'DOENCA_DESCRICAO', 'VALOR_POR_FORA', 'VALOR_AUX_ALIMENTACAO',
  'CCT_ANO', 'CCT_CLAUSULAS', 'CCT_CLAUSULA_MULTA',
  'PERIODO_FERIAS_PROP', 'PERIODO_13', 'PERIODO_FERIAS_VENCIDAS',
  'VALOR_SALDO_SALARIO', 'VALOR_MULTA_467',
  'VALOR_AVISO_PREVIO', 'VALOR_13', 'VALOR_FERIAS', 'VALOR_FGTS', 'VALOR_MULTA_40',
  'VALOR_FT', 'VALOR_DSR', 'VALOR_DANO_MORAL_10X', 'VALOR_CAUSA_TOTAL', 'DATA_PECA',
  'VALOR_MULTA_477', 'VALOR_SALARIOS_ABERTO', 'VALOR_HONORARIOS',
];

export const FLAGS_TEMPLATE = [
  'tem_tomadora', 'sem_justa_causa', 'rescisao_indireta', 'coacao_demissao', 'reversao_justa_causa',
  'tem_capitulo_rescisao', 'aviso_reversao', 'aviso_normal', 'acumulo_funcao', 'escala_12x36',
  'escala_4x2', 'adicional_noturno', 'integracao_por_fora', 'periculosidade', 'assiduidade',
  'vale_transporte', 'auxilio_alimentacao', 'doenca_ocupacional', 'estabilidade_doenca',
  'pensao_vitalicia', 'folgas_trabalhadas', 'tem_ferias_vencidas',
];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function dataExtenso(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, ano, mes, dia] = m;
  return `${Number(dia)} de ${MESES[Number(mes) - 1]} de ${ano}`;
}

const TRT_POR_UF = {
  SP: 'SEGUNDA REGIÃO', RJ: 'PRIMEIRA REGIÃO', MG: 'TERCEIRA REGIÃO', RS: 'QUARTA REGIÃO',
  BA: 'QUINTA REGIÃO', PE: 'SEXTA REGIÃO', CE: 'SÉTIMA REGIÃO', PA: 'OITAVA REGIÃO',
  PR: 'NONA REGIÃO', DF: 'DÉCIMA REGIÃO', AM: 'DÉCIMA PRIMEIRA REGIÃO', SC: 'DÉCIMA SEGUNDA REGIÃO',
  GO: 'DÉCIMA OITAVA REGIÃO',
};

const MODO_RESCISAO = {
  sem_justa_causa: 'sem justa causa',
  rescisao_indireta: 'rescisão indireta',
  nulidade_pedido_demissao: 'pedido de demissão coagido',
  reversao_justa_causa: 'justa causa (a reverter)',
  acordo: 'acordo (art. 484-A da CLT)',
};

const MOTIVO_SAIDA = {
  sem_justa_causa: 'sido dispensado sem justa causa',
  rescisao_indireta: 'requerido a rescisão indireta do contrato',
  nulidade_pedido_demissao: 'sido coagido e ameaçado a pedir demissão',
  reversao_justa_causa: 'sido dispensado por justa causa',
  acordo: 'encerrado o contrato por acordo',
};

const flag = (v) => !!v;
const soDigitos = (s) => (s || '').replace(/\D/g, '');
// 0 numérico vira vazio (evita "R$ 0,00" no template quando o valor não foi extraído)
const valorOuTexto = (v) => (v == null || v === '' || v === 0 ? '' : typeof v === 'number' ? formatBRL(v) : String(v));

// Correções de grafia de municípios recorrentes (erros de digitação/OCR do template e da IA)
const CORRECOES_MUNICIPIO = {
  'ITAPECERICA DA TERRA': 'ITAPECERICA DA SERRA',
  'ITAPECERICA DA TERRA/SP': 'ITAPECERICA DA SERRA/SP',
  'SAO PAULO/SP': 'SÃO PAULO/SP',
};
function corrigirMunicipio(nome) {
  if (!nome) return nome;
  return CORRECOES_MUNICIPIO[String(nome).toUpperCase()] || nome;
}

function cepDoEndereco(end) {
  const m = /(\d{5})-?(\d{3})/.exec(String(end || ''));
  return m ? `${m[1]}${m[2]}` : null;
}

// Competência = local da PRESTAÇÃO DE SERVIÇOS (art. 651 CLT), NÃO a residência
// do empregado. Preferência: endereço da tomadora (recl2_logradouro) > local de
// prestação informado > endereço da empregadora. Rejeita o endereço residencial.
function localPrestacao(caso, dadosCep = []) {
  const resid = (caso?.recl_endereco || '').trim();
  const cand = [caso?.recl2_logradouro, caso?.local_prestacao, caso?.recl1_logradouro]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter((s) => s !== resid);
  for (const end of cand) {
    const cep = cepDoEndereco(end);
    const v = (dadosCep || []).find(
      (d) => d && !d.erro && d.municipio && (!cep || String(d.cep || '').replace(/\D/g, '') === cep)
    );
    if (v) return { municipio: corrigirMunicipio(v.municipio), uf: v.uf };
  }
  return null;
}

function montarVaraCidadeRegiao(caso, local) {
  const municipio = corrigirMunicipio(local?.municipio || caso.comarca || '');
  const uf = (local?.uf || (caso.comarca_uf || '').replace(/[^A-Za-z]/g, '')).toUpperCase().slice(0, 2);
  if (!municipio) return '';
  const regiao = TRT_POR_UF[uf];
  return `${municipio.toUpperCase()}${uf ? `/${uf}` : ''}${regiao ? ` – ${regiao}` : ''}`;
}

function hojeExtenso() {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// Narrativa CONCRETA do dano moral — determinística e coerente. Quando o
// parser devolve apenas um fragmento (ex.: "direitos lesados.") ou a IA de
// redação está desligada, constrói um parágrafo articulado a partir dos fatos
// do caso (desvio sem contraprestação, folgas via PIX/dinheiro, etc.). A IA,
// quando ativa, sobrescreve via BLOCO_DANO_MORAL (geracao.js).
export function narrativaDanoMoral(caso) {
  const raw = (caso.dano_fatos || caso.dano_supervisor || '').trim();
  if (raw.length >= 80) return raw; // narrativa real do parser — usa como está
  const fatos = [];
  if (caso.tem_desvio && caso.desvio_atividades) {
    const atv = String(caso.desvio_atividades).replace(/[.\s]+$/, '').toLowerCase().slice(0, 140);
    fatos.push(`compelido a exercer, de forma habitual, atribuições alheias à função contratada (desvio de função — ${atv}) sem qualquer contraprestação pecuniária`);
  }
  if (caso.tem_ft && (caso.tem_integracao_por_fora || /pix|dinheiro/i.test(raw))) {
    fatos.push(`laborado em dias de folga mediante pagamento informal (via PIX/dinheiro), à margem da folha salarial e dos recolhimentos previdenciários`);
  }
  if (!fatos.length && caso.tem_integracao_por_fora) {
    fatos.push('submetido a pagamentos por fora, sem os devidos recolhimentos previdenciários e fiscais');
  }
  const corpus = fatos.length
    ? `Durante todo o pacto contratual, o reclamante foi ${fatos.join(', ')}. `
    : (raw ? `${raw} ` : '');
  return `${corpus}Tais condutas ilícitas da reclamada violaram a dignidade pessoal e os valores morais do autor, gerando angústia, sofrimento e indignação, a ensejar a devida reparação moral.`;
}

export function montarDadosTemplate({ caso = {}, calculos = [], attrs = {}, dadosReceita = [], dadosCep = [] } = {}) {
  const dados = {};

  // 1) Valores determinísticos
  let somaCausa = 0;
  for (const c of calculos || []) {
    if (c.valor == null) continue;
    const campo = CALC_CAMPO[c.item];
    if (campo) dados[campo] = formatBRL(c.valor);
    // Honorários são calculados À PARTE (15% sobre o valor da causa, art. 85
    // CPC) — padrão do escritório. Não compõem o valor da causa (o rol de
    // pedidos não os lista como valor), senão o fecho fica maior que a soma
    // do rol. VALOR_HONORARIOS continua disponível para o tópico de honorários.
    if (c.item !== 'Honorários advocatícios (15%)') somaCausa += Number(c.valor) || 0;
  }
  const valorCausa = brlComExtenso(round2(somaCausa));
  dados.VALOR_CAUSA_TOTAL = valorCausa;
  // Aliases — algumas versões do template usam tags diferentes para o mesmo valor
  dados.VALOR_CAUSA = valorCausa;
  dados.VALOR_TOTAL_PEDIDOS = valorCausa;

  // Avos/dias para placeholders do template (frações de 13º/férias e dias de aviso)
  for (const c of calculos || []) {
    if (c.item === '13º proporcional') {
      const m = /(\d+)\/12/.exec(c.memoria || '');
      if (m) { dados.AVOS_13 = m[1]; dados.AVOS_13_FRACAO = `${m[1]}/12`; }
    }
    if (c.item === 'Férias proporcionais + 1/3') {
      const m = /(\d+)\/12/.exec(c.memoria || '');
      if (m) { dados.AVOS_FERIAS = m[1]; dados.AVOS_FERIAS_FRACAO = `${m[1]}/12`; }
    }
    if (c.item === 'Aviso prévio indenizado') {
      const m = /(\d+)\s*dias/.exec(c.memoria || '');
      if (m) dados.DIAS_AVISO_PREVIO = m[1];
    }
  }

  // 2) CNPJ oficial (BrasilAPI)
  const receita = (cnpj) => (dadosReceita || []).find((d) => d && !d.erro && soDigitos(d.cnpj) === soDigitos(cnpj));
  const r1 = receita(caso.recl1_cnpj);
  const r2 = receita(caso.recl2_cnpj);

  // 3) Competência
  const local = localPrestacao(caso, dadosCep);
  dados.VARA_CIDADE_REGIAO = montarVaraCidadeRegiao(caso, local) || '[VARA / CIDADE / REGIÃO]';
  // LOCAL DE PRESTAÇÃO: nunca o endereço residencial do reclamante. Preferência:
  // tomadora (recl2) > local informado > empregadora (recl1/receita). Rejeita o
  // endereço residencial em qualquer posição (o parser pode tê-lo gravado em
  // local_prestacao/recl2_logradouro por erro); se houver 2ª reclamada, usa o
  // endereço da tomadora vindo da Receita (r2.endereco) quando o parser não o
  // extraiu da entrevista.
  // Rejeita a residência do reclamante por CEP (robusto a correções de
  // grafia/acento feitas pelo parser ou ViaCEP) — a comparação por string
  // exata falhava quando a residência vinha normalizada e vazava como local
  // de prestação. Preferência: tomadora (recl2) > local informado > empregadora.
  const residEnd = (caso.recl_endereco || '').trim().toLowerCase();
  const cepResid = cepDoEndereco(caso.recl_endereco);
  const rejeitarResid = (s) => {
    if (!s) return true;
    if (String(s).trim().toLowerCase() === residEnd) return true;
    const cep = cepDoEndereco(s);
    return Boolean(cepResid && cep && cep === cepResid);
  };
  const localInformado = caso.local_prestacao && !rejeitarResid(caso.local_prestacao) ? caso.local_prestacao : null;
  const candLocal = [
    localInformado, caso.recl2_logradouro, (r2 && r2.endereco), caso.recl1_logradouro, (r1 && r1.endereco),
  ].filter(Boolean).map((s) => String(s).trim()).filter((s) => !rejeitarResid(s));
  dados.LOCAL_PRESTACAO_ENDERECO = candLocal[0] || '[LOCAL DE PRESTAÇÃO]';
  dados.RITO = attrs.rito === 'sumarissimo' ? 'sumaríssimo' : 'ordinário';

  // 4) Reclamante
  dados.RECL_NOME = (caso.recl_nome || '[NOME DO RECLAMANTE]').toUpperCase();
  const _genNac = (caso.recl_genero || 'M').toUpperCase() === 'F' ? 'F' : 'M';
  dados.RECL_NACIONALIDADE = caso.recl_nacionalidade || (_genNac === 'F' ? 'brasileira' : 'brasileiro');
  dados.RECL_ESTADO_CIVIL = caso.recl_estado_civil || '[ESTADO CIVIL]';
  dados.RECL_FUNCAO = caso.funcao || attrs.funcao || '[FUNÇÃO]';
  dados.RECL_RG = caso.recl_rg || '[RG]';
  dados.RECL_CPF = caso.recl_cpf || '[CPF]';
  dados.RECL_PIS = caso.recl_pis || '[PIS]';
  dados.RECL_CTPS = caso.recl_ctps || '[CTPS]';
  dados.RECL_SERIE = caso.recl_serie || '[SÉRIE]';
  dados.RECL_NASCIMENTO = dataExtenso(caso.recl_nascimento) || '[DATA DE NASCIMENTO]';
  dados.RECL_FILIACAO = caso.recl_filiacao || '[FILIAÇÃO]';
  dados.RECL_ENDERECO = caso.recl_endereco || '[ENDEREÇO DO RECLAMANTE]';
  dados.RECL_EMAIL = caso.recl_email || '';

  // 5) Reclamadas
  // Nome da reclamada vem da ENTREVISTA (fonte primária); o CNPJ oficial só
  // confirma endereço e número. Nunca substituir o nome informado pelo cliente
  // por uma razão social retornada pela Receita (pode ser entidade diversa).
  dados.RECLAMADA1_RAZAO = caso.recl1_nome || (r1 && r1.razao_social) || '[RAZÃO SOCIAL 1ª RECLAMADA]';
  dados.RECLAMADA1_CNPJ = (r1 && r1.cnpj) || caso.recl1_cnpj || '[CNPJ - confirmar]';
  dados.RECLAMADA1_ENDERECO = (r1 && r1.endereco) || caso.recl1_logradouro || '[ENDEREÇO - confirmar]';
  dados.RECLAMADA2_RAZAO = caso.recl2_nome || (r2 && r2.razao_social) || '';
  dados.RECLAMADA2_CNPJ = (r2 && r2.cnpj) || caso.recl2_cnpj || '';
  dados.RECLAMADA2_ENDERECO = caso.recl2_logradouro || (r2 && r2.endereco) || '';

  // 6) Contrato / rescisão
  const tipo = caso.tipo_dispensa || attrs.tipo_dispensa || 'sem_justa_causa';
  dados.DATA_ADMISSAO = dataExtenso(caso.data_admissao) || '[DATA DE ADMISSÃO]';
  dados.DATA_RESCISAO = dataExtenso(caso.data_rescisao) || '[DATA DE RESCISÃO]';
  dados.SALARIO = caso.salario != null ? brlComExtenso(caso.salario) : '[SALÁRIO]';
  dados.RECL_GENERO = (caso.recl_genero || 'M').toUpperCase() === 'F' ? 'F' : 'M';
  dados.MODO_RESCISAO = MODO_RESCISAO[tipo] || 'sem justa causa';
  dados.MOTIVO_SAIDA_RESUMIDO = MOTIVO_SAIDA[tipo] || 'foi dispensado sem justa causa';

  // 7) Textos livres do caso concreto (parser)
  dados.DANO_MORAL_FATO_ESPECIFICO = caso.tem_dano_moral ? narrativaDanoMoral(caso) : '[DESCREVER O FATO CONCRETO DO DANO MORAL]';

  // 8) Jornada
  dados.JORNADA_HORARIOS = caso.jornada_horario || '[HORÁRIOS]';
  dados.ESCALA = caso.escala || '[ESCALA]';
  dados.INTERVALO_USUFRUIDO = caso.intervalo_usufruido || '';
  dados.PRORROGACAO_JORNADA = caso.prorrogacao_jornada || '';
  dados.FOLGAS_LABORADAS_MES = caso.ft_qtd_media != null ? String(caso.ft_qtd_media) : (caso.folgas_laboradas_mes || '');

  // 9) Teses (dados de apoio)
  dados.ACUMULO_ATIVIDADES = caso.acumulo_atividades || caso.acumulo_funcao || '';
  // Desvio: se a flag acendeu mas o parser não descreveu as atividades, evita o
  // placeholder vazio (que gera "funções de VIGILANTE, , não recebeu" no template).
  dados.DESVIO_ATIVIDADES = caso.desvio_atividades || (caso.tem_desvio ? 'atividades diversas da função contratada' : '');
  dados.SALARIOS_ABERTO = caso.salarios_aberto || '';
  dados.ASSIDUIDADE_PROMETIDO = valorOuTexto(caso.assiduidade_prometido);
  dados.ASSIDUIDADE_PAGO = valorOuTexto(caso.assiduidade_pago);
  dados.ASSIDUIDADE_DIFERENCA = valorOuTexto(caso.assiduidade_diferenca);
  dados.DOENCA_DESCRICAO = caso.doenca_descricao || '';
  dados.VALOR_POR_FORA = valorOuTexto(caso.valor_por_fora);
  dados.VALOR_AUX_ALIMENTACAO = valorOuTexto(caso.valor_aux_alimentacao);

  // 10) CCT
  dados.CCT_ANO = caso.cct_ano || '';
  dados.CCT_CLAUSULAS = caso.cct_clausulas || '';
  // Cláusula da multa convencional: se não extraída, string vazia — o bloco
  // BLOCO_MULTAS_CONVENCIONAIS (fallback ou IA) já trata a ausência do número
  // no texto, evitando [A PREENCHER: CCT_CLAUSULA_MULTA] no documento final.
  dados.CCT_CLAUSULA_MULTA = caso.cct_clausula_multa || '';

  // 11) Verbas rescisórias — períodos
  dados.PERIODO_FERIAS_PROP = caso.periodo_ferias_prop || '';
  dados.PERIODO_13 = caso.periodo_13 || '';
  dados.PERIODO_FERIAS_VENCIDAS = caso.periodo_ferias_vencidas || '';

  // 12) Data da peça
  dados.DATA_PECA = `São Paulo, ${hojeExtenso()}`;

  // 13) FLAGS — seções condicionais
  const temTomadora = flag(caso.recl2_nome || r2 || attrs.tem_tomadora);
  const escalaTxt = `${caso.escala || ''} ${caso.jornada_horario || ''}`;
  const ehVigilante = /vigilante/i.test(caso.funcao || attrs.funcao || '');
  dados.tem_tomadora = temTomadora;
  dados.sem_justa_causa = tipo === 'sem_justa_causa';
  dados.rescisao_indireta = tipo === 'rescisao_indireta';
  dados.coacao_demissao = tipo === 'nulidade_pedido_demissao';
  dados.reversao_justa_causa = tipo === 'reversao_justa_causa';
  dados.tem_capitulo_rescisao = ['rescisao_indireta', 'nulidade_pedido_demissao', 'reversao_justa_causa'].includes(tipo);
  dados.aviso_reversao = tipo === 'rescisao_indireta' || tipo === 'reversao_justa_causa';
  dados.aviso_normal = tipo === 'sem_justa_causa' || tipo === 'nulidade_pedido_demissao';
  // Acúmulo só ativa com atividades PRÓPRIAS descritas; se coincide com o desvio
  // (mesmos fatos de Prevenção de Perdas), fica só desvio — evita bis in idem.
  const mesmoFatoDesvio =
    caso.tem_desvio && caso.acumulo_atividades && caso.desvio_atividades &&
    String(caso.acumulo_atividades).toLowerCase() === String(caso.desvio_atividades).toLowerCase();
  dados.acumulo_funcao = flag(caso.tem_acumulo && caso.acumulo_atividades && !mesmoFatoDesvio);
  dados.desvio_funcao = flag(caso.tem_desvio);
  dados.gratificacao_funcao = flag(caso.tem_gratificacao);
  dados.escala_12x36 = /12\s*x\s*36/i.test(escalaTxt);
  dados.escala_4x2 = /\b(4\s*x\s*2|6\s*x\s*2)\b/i.test(escalaTxt);
  dados.adicional_noturno = flag(caso.tem_adic_noturno);
  dados.integracao_por_fora = flag(caso.tem_integracao_por_fora);
  // Vigilância: 10 min (cláusula 33ª) e periculosidade nas HE são padrão da categoria.
  dados.periculosidade = flag(caso.tem_periculosidade) || ehVigilante;
  dados.dez_minutos_cct = flag(caso.tem_dez_min_cct) || ehVigilante;
  dados.salarios_em_aberto = flag(caso.tem_salarios_aberto);
  dados.assiduidade = flag(caso.tem_assiduidade);
  dados.vale_transporte = flag(caso.tem_vale_transporte);
  dados.auxilio_alimentacao = flag(caso.tem_auxilio_alimentacao);
  dados.doenca_ocupacional = flag(caso.tem_doenca);
  dados.estabilidade_doenca = flag(caso.tem_estabilidade || caso.tem_doenca);
  dados.pensao_vitalicia = flag(caso.tem_pensao);
  dados.insalubridade = flag(caso.tem_insalubridade);
  dados.folgas_trabalhadas = flag(caso.tem_ft || caso.val_ft || caso.ft_qtd_media);
  dados.tem_ferias_vencidas = flag(caso.tem_ferias_vencidas);

  // Fallback dos pedidos: tese ligada mas valor não calculado -> "a apurar em liquidação"
  // (evita pedido em branco, ex.: folgas sem valor por folga informado).
  const APURAR = 'a apurar em liquidação';
  dados.FT_100 = (dados.VALOR_FT || dados.VALOR_DSR)
    ? [dados.VALOR_FT, dados.VALOR_DSR].filter(Boolean).join(' + ')
    : APURAR;
  for (const [fl, cp] of [
    ['acumulo_funcao', 'VALOR_ACUMULO'], ['gratificacao_funcao', 'VALOR_GRATIFICACAO'],
    ['desvio_funcao', 'VALOR_DESVIO'], ['assiduidade', 'VALOR_ASSIDUIDADE'],
    ['integracao_por_fora', 'VALOR_INTEGRACAO'], ['auxilio_alimentacao', 'VALOR_AUX_ALIM_TOTAL'],
    ['vale_transporte', 'VALOR_VT_TOTAL'],
  ]) {
    if (dados[fl] && !dados[cp]) dados[cp] = APURAR;
  }

  // Fallback do capítulo de enquadramento (desvio): se a IA não redigir
  // (redigirIA false ou falha), o marcador {{BLOCO_ENQUADRAMENTO}} do
  // template ainda recebe um texto rico determinístico (não fica vazio).
  // Quando a IA roda com sucesso, geracao.js sobrescreve pelo capítulo
  // sob medida da especialista de IA.
  if (dados.desvio_funcao) {
    const atv = caso.desvio_atividades || 'atividades diversas da função contratada';
    const clausulaDesvio = caso.cct_clausula_multa ? `cláusula ${caso.cct_clausula_multa}` : 'cláusula de desvio de função';
    dados.BLOCO_ENQUADRAMENTO =
      `Não obstante contratado para exercer a função de ${(caso.funcao || '[FUNÇÃO]').toUpperCase()}, o reclamante era compelido, por determinação da 1ª reclamada${dados.tem_tomadora ? ' e no interesse da 2ª reclamada' : ''}, a exercer, de forma habitual, ${atv}, funções de maior complexidade e responsabilidade que extrapolam as tarefas típicas da função contratada, em flagrante desvio funcional, vedado pela ${clausulaDesvio} da Convenção Coletiva de Trabalho da Categoria. ` +
      `Portanto, requer a condenação da reclamada ao pagamento da multa convencional de 50% (cinquenta por cento) do piso salarial da categoria por mês laborado, durante todo o período contratual, com reflexos em DSR, aviso prévio, férias acrescidas de 1/3, 13º salários e FGTS + 40%.`;
  }

  // Fallback da seção "DAS MULTAS CONVENCIONAIS": abertura coerente quando a
  // IA não redigir (ou está desativada). Substitui a frase fixa do template
  // (que dependia de {{CCT_CLAUSULA_MULTA}} em branco) por um parágrafo
  // completo; a IA sobrescreve quando ativa (redacaoTeses).
  {
    const anoCct = caso.cct_ano || '';
    const clMulta = caso.cct_clausula_multa ? ` (cláusula ${caso.cct_clausula_multa})` : '';
    dados.BLOCO_MULTAS_CONVENCIONAIS =
      `O reclamante requer a aplicação da multa convencional prevista na Convenção Coletiva de Trabalho da categoria${anoCct ? ` – ${anoCct} e as anteriores` : ''}${clMulta}, por descumprimento, pela reclamada, das obrigações convencionais a seguir elencadas, nos termos da cláusula de penalidade da referida convenção:`;
  }

  // Fallback da seção "DA JORNADA DE TRABALHO": narrativa fática coerente
  // quando a IA não redigir o BLOCO_JORNADA (desativada ou retorno vazio).
  // Constrói o parágrafo a partir dos campos do caso (jornada_horario,
  // escala, prorrogacao_jornada) — SEM a tag crua {{PRORROGACAO_JORNADA}},
  // que aparecia no template quando o parser não extraía o campo. A IA
  // sobrescreve via BLOCO_JORNADA (geracao.js) quando ativa.
  {
    const hor = caso.jornada_horario || '[HORÁRIOS]';
    const esc = caso.escala || (dados.escala_12x36 ? '12x36' : dados.escala_4x2 ? '4x2' : '[ESCALA]');
    const prorrog = caso.prorrogacao_jornada ? `, estendia a jornada ${caso.prorrogacao_jornada}` : '';
    const intervaloTxt = caso.intervalo_usufruido
      ? `concessão parcial do intervalo para refeição e descanso de ${caso.intervalo_usufruido}`
      : 'concessão parcial do intervalo intrajornada';
    dados.BLOCO_JORNADA =
      `Para elucidação dos direitos aqui pleiteados, o reclamante laborou no seguinte horário: ${hor}, dependendo das necessidades dos serviços${prorrog}, sob pena de advertência, ou até mesmo justa causa, em escala ${esc}, com a ${intervaloTxt}. ` +
      `Cumpre ressaltar que o obreiro pode ter feito outras escalas e horários que serão devidamente apreciados em audiência inaugural e, posteriormente, em sede de réplica.`;
  }

  // Fallback da ESPINHA DA RESCISÃO: narrativa padrão da modalidade aplicável
  // (determinística). A IA sobrescreve via BLOCO_ESPINHA_RESCISAO quando ativa.
  if (!dados.BLOCO_ESPINHA_RESCISAO) {
    const motivo = dados.MOTIVO_SAIDA_RESUMIDO || 'foi dispensado sem justa causa';
    let nucleo;
    if (dados.sem_justa_causa) {
      nucleo = 'A dispensa imotivada resta plenamente configurada, não havendo qualquer conduta faltosa por parte do reclamante que justificasse a medida, restando asseguradas todas as verbas rescisórias previstas na legislação trabalhista.';
    } else if (dados.rescisao_indireta) {
      nucleo = 'A rescisão indireta do contrato de trabalho resta configurada nos termos do art. 483 da CLT, em virtude das graves violações contratuais praticadas pela reclamada, autorizando o reclamante a pleitear todas as verbas rescisórias como se dispensado sem justa causa fosse.';
    } else if (dados.coacao_demissao) {
      nucleo = 'O pedido de demissão restou eivado de nulidade, por ter sido extraído mediante coação e ameaça, configurando vício de consentimento nos termos do art. 9º da CLT, devendo ser reconhecida a nulidade do pedido de demissão e a recondução à rescisão imotivada.';
    } else if (dados.reversao_justa_causa) {
      nucleo = 'A justa causa aplicada carece de lastro fático e probatório, devendo ser revertida em dispensa imotivada, com o pagamento de todas as verbas rescisórias decorrentes.';
    } else {
      nucleo = 'A modalidade rescisória resta configurada nos termos da legislação aplicável, restando asseguradas as verbas decorrentes.';
    }
    dados.BLOCO_ESPINHA_RESCISAO =
      `O reclamante foi admitido pela 1ª reclamada em ${dados.DATA_ADMISSAO || '[DATA DE ADMISSÃO]'}, ` +
      `para exercer a função de ${dados.RECL_FUNCAO || '[FUNÇÃO]'}, tendo ${motivo} em ${dados.DATA_RESCISAO || '[DATA DE RESCISÃO]'}. ` +
      `${nucleo} ` +
      `Diante do exposto, requer o reconhecimento da modalidade rescisória acima delineada, com o pagamento de todas as verbas rescisórias devidas, nos termos do rol de pedidos ao final apresentado.`;
  }

  // Fallback do DANO MORAL: narrativa concreta determinística (mesma do
  // DANO_MORAL_FATO_ESPECIFICO). A IA sobrescreve via BLOCO_DANO_MORAL.
  if (!dados.BLOCO_DANO_MORAL && caso.tem_dano_moral) {
    dados.BLOCO_DANO_MORAL = dados.DANO_MORAL_FATO_ESPECIFICO || narrativaDanoMoral(caso);
  }

  // Fallback da INSALUBRIDADE: narrativa determinística do ambiente insalubre.
  // A IA sobrescreve via BLOCO_INSALUBRIDADE quando ativa.
  if (!dados.BLOCO_INSALUBRIDADE && dados.insalubridade) {
    dados.BLOCO_INSALUBRIDADE = caso.insalubridade_descricao ||
      'O reclamante laborava em ambiente insalubre, sem a observância das normas de saúde, segurança e higiene do trabalho, e sem o fornecimento de equipamentos de proteção individual adequados, configurando violação aos arts. 189 e 192 da CLT.';
  }

  // Fallback da SÚMULA 331 (responsabilidade subsidiária): parágrafo padrão.
  // A IA sobrescreve via BLOCO_SUMULA_331 quando ativa.
  if (!dados.BLOCO_SUMULA_331 && dados.tem_tomadora) {
    dados.BLOCO_SUMULA_331 =
      `A 2ª reclamada, na qualidade de tomadora dos serviços, responde subsidiariamente pelas obrigações trabalhistas contraídas pela 1ª reclamada em relação ao reclamante, com fundamento na Súmula 331 do Tribunal Superior do Trabalho e nos artigos 4º e 5º do Decreto-Lei nº 200/1967, eis que o obreiro desempenhava suas atividades integrado à atividade-fim da tomadora, exercendo funções essenciais e permanentes, o que atrai a responsabilidade subsidiária da contratante pelos créditos deferidos nesta ação.`;
  }

  return dados;
}