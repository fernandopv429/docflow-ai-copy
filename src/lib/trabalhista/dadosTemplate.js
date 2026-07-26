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
  '13º proporcional': 'VALOR_13',
  'Férias proporcionais + 1/3': 'VALOR_FERIAS',
  'FGTS do período (8%)': 'VALOR_FGTS',
  'Multa de 40% do FGTS': 'VALOR_MULTA_40',
  'Dano moral (10x remuneração)': 'VALOR_DANO_MORAL_10X',
  'Folgas trabalhadas (100%)': 'VALOR_FT',
  'Reflexo DSR sobre FT (1/6)': 'VALOR_DSR',
  'Acúmulo de função (20%)': 'VALOR_ACUMULO',
  'Bonificação de assiduidade (diferença)': 'VALOR_ASSIDUIDADE',
  'Integração de valores por fora': 'VALOR_INTEGRACAO',
  'Auxílio-alimentação nas folgas': 'VALOR_AUX_ALIM_TOTAL',
  'Vale-transporte nas folgas': 'VALOR_VT_TOTAL',
  'Gratificação de função (10%)': 'VALOR_GRATIFICACAO',
  'Desvio de função (50%)': 'VALOR_DESVIO',
};

const TETO_VALOR_CAUSA = 400000;

// Contrato de tags do .docx (documentação viva).
export const CAMPOS_TEMPLATE = [
  'VARA_CIDADE_REGIAO', 'RITO',
  'RECL_NOME', 'RECL_NACIONALIDADE', 'RECL_ESTADO_CIVIL', 'RECL_FUNCAO', 'RECL_RG', 'RECL_CPF',
  'RECL_PIS', 'RECL_CTPS', 'RECL_SERIE', 'RECL_NASCIMENTO', 'RECL_FILIACAO', 'RECL_ENDERECO',
  'RECLAMADA1_RAZAO', 'RECLAMADA1_CNPJ', 'RECLAMADA1_ENDERECO',
  'RECLAMADA2_RAZAO', 'RECLAMADA2_CNPJ', 'RECLAMADA2_ENDERECO',
  'LOCAL_PRESTACAO_ENDERECO', 'DATA_ADMISSAO', 'DATA_RESCISAO', 'SALARIO',
  'MODO_RESCISAO', 'MOTIVO_SAIDA_RESUMIDO', 'DANO_MORAL_FATO_ESPECIFICO',
  'JORNADA_HORARIOS', 'ESCALA', 'INTERVALO_USUFRUIDO', 'PRORROGACAO_JORNADA', 'FOLGAS_LABORADAS_MES',
  'ACUMULO_ATIVIDADES', 'ASSIDUIDADE_PROMETIDO', 'ASSIDUIDADE_PAGO', 'ASSIDUIDADE_DIFERENCA',
  'DOENCA_DESCRICAO', 'VALOR_POR_FORA', 'VALOR_AUX_ALIMENTACAO',
  'CCT_ANO', 'CCT_CLAUSULAS', 'CCT_CLAUSULA_MULTA',
  'PERIODO_FERIAS_PROP', 'PERIODO_13', 'PERIODO_FERIAS_VENCIDAS',
  'VALOR_AVISO_PREVIO', 'VALOR_13', 'VALOR_FERIAS', 'VALOR_FGTS', 'VALOR_MULTA_40',
  'VALOR_FT', 'VALOR_DSR', 'VALOR_DANO_MORAL_10X', 'VALOR_CAUSA_TOTAL', 'DATA_PECA',
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
  sem_justa_causa: 'foi dispensado sem justa causa',
  rescisao_indireta: 'requereu a rescisão indireta do contrato',
  nulidade_pedido_demissao: 'foi coagido e ameaçado a pedir demissão',
  reversao_justa_causa: 'foi dispensado por justa causa',
  acordo: 'encerrou o contrato por acordo',
};

const flag = (v) => !!v;
const soDigitos = (s) => (s || '').replace(/\D/g, '');
const valorOuTexto = (v) => (v == null || v === '' ? '' : typeof v === 'number' ? formatBRL(v) : String(v));

function localPrestacao(dadosCep = []) {
  const v = (dadosCep || []).find((d) => d && !d.erro && d.municipio);
  return v ? { municipio: v.municipio, uf: v.uf } : null;
}

function montarVaraCidadeRegiao(caso, local) {
  const municipio = local?.municipio || caso.comarca || '';
  const uf = (local?.uf || (caso.comarca_uf || '').replace(/[^A-Za-z]/g, '')).toUpperCase().slice(0, 2);
  if (!municipio) return '';
  const regiao = TRT_POR_UF[uf];
  return `${municipio.toUpperCase()}${uf ? `/${uf}` : ''}${regiao ? ` – ${regiao}` : ''}`;
}

function hojeExtenso() {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function montarDadosTemplate({ caso = {}, calculos = [], attrs = {}, dadosReceita = [], dadosCep = [] } = {}) {
  const dados = {};

  // 1) Valores determinísticos
  let somaCausa = 0;
  for (const c of calculos || []) {
    if (c.valor == null) continue;
    const campo = CALC_CAMPO[c.item];
    if (campo) dados[campo] = formatBRL(c.valor);
    somaCausa += Number(c.valor) || 0;
  }
  dados.VALOR_CAUSA_TOTAL = brlComExtenso(round2(Math.min(somaCausa, TETO_VALOR_CAUSA)));

  // 2) CNPJ oficial (BrasilAPI)
  const receita = (cnpj) => (dadosReceita || []).find((d) => d && !d.erro && soDigitos(d.cnpj) === soDigitos(cnpj));
  const r1 = receita(caso.recl1_cnpj);
  const r2 = receita(caso.recl2_cnpj);

  // 3) Competência
  const local = localPrestacao(dadosCep);
  dados.VARA_CIDADE_REGIAO = montarVaraCidadeRegiao(caso, local) || '[VARA / CIDADE / REGIÃO]';
  dados.LOCAL_PRESTACAO_ENDERECO = caso.local_prestacao || caso.recl1_logradouro || (r1 && r1.endereco) || '[LOCAL DE PRESTAÇÃO]';
  dados.RITO = attrs.rito === 'sumarissimo' ? 'sumaríssimo' : 'ordinário';

  // 4) Reclamante
  dados.RECL_NOME = (caso.recl_nome || '[NOME DO RECLAMANTE]').toUpperCase();
  dados.RECL_NACIONALIDADE = caso.recl_nacionalidade || 'brasileiro(a)';
  dados.RECL_ESTADO_CIVIL = caso.recl_estado_civil || '[ESTADO CIVIL]';
  dados.RECL_FUNCAO = caso.funcao || '[FUNÇÃO]';
  dados.RECL_RG = caso.recl_rg || '[RG]';
  dados.RECL_CPF = caso.recl_cpf || '[CPF]';
  dados.RECL_PIS = caso.recl_pis || '[PIS]';
  dados.RECL_CTPS = caso.recl_ctps || '[CTPS]';
  dados.RECL_SERIE = caso.recl_serie || '[SÉRIE]';
  dados.RECL_NASCIMENTO = dataExtenso(caso.recl_nascimento) || '[DATA DE NASCIMENTO]';
  dados.RECL_FILIACAO = caso.recl_filiacao || '[FILIAÇÃO]';
  dados.RECL_ENDERECO = caso.recl_endereco || '[ENDEREÇO DO RECLAMANTE]';

  // 5) Reclamadas
  dados.RECLAMADA1_RAZAO = (r1 && r1.razao_social) || caso.recl1_nome || '[RAZÃO SOCIAL 1ª RECLAMADA]';
  dados.RECLAMADA1_CNPJ = (r1 && r1.cnpj) || caso.recl1_cnpj || '[CNPJ - confirmar]';
  dados.RECLAMADA1_ENDERECO = (r1 && r1.endereco) || caso.recl1_logradouro || '[ENDEREÇO - confirmar]';
  dados.RECLAMADA2_RAZAO = (r2 && r2.razao_social) || caso.recl2_nome || '';
  dados.RECLAMADA2_CNPJ = (r2 && r2.cnpj) || caso.recl2_cnpj || '';
  dados.RECLAMADA2_ENDERECO = (r2 && r2.endereco) || '';

  // 6) Contrato / rescisão
  const tipo = caso.tipo_dispensa || attrs.tipo_dispensa || 'sem_justa_causa';
  dados.DATA_ADMISSAO = dataExtenso(caso.data_admissao) || '[DATA DE ADMISSÃO]';
  dados.DATA_RESCISAO = dataExtenso(caso.data_rescisao) || '[DATA DE RESCISÃO]';
  dados.SALARIO = caso.salario != null ? brlComExtenso(caso.salario) : '[SALÁRIO]';
  dados.RECL_GENERO = (caso.recl_genero || 'M').toUpperCase() === 'F' ? 'F' : 'M';
  dados.MODO_RESCISAO = MODO_RESCISAO[tipo] || 'sem justa causa';
  dados.MOTIVO_SAIDA_RESUMIDO = MOTIVO_SAIDA[tipo] || 'foi dispensado sem justa causa';

  // 7) Textos livres do caso concreto (parser)
  dados.DANO_MORAL_FATO_ESPECIFICO = caso.dano_fatos || caso.dano_supervisor || '[DESCREVER O FATO CONCRETO DO DANO MORAL]';

  // 8) Jornada
  dados.JORNADA_HORARIOS = caso.jornada_horario || '[HORÁRIOS]';
  dados.ESCALA = caso.escala || '[ESCALA]';
  dados.INTERVALO_USUFRUIDO = caso.intervalo_usufruido || '';
  dados.PRORROGACAO_JORNADA = caso.prorrogacao_jornada || '';
  dados.FOLGAS_LABORADAS_MES = caso.ft_qtd_media != null ? String(caso.ft_qtd_media) : (caso.folgas_laboradas_mes || '');

  // 9) Teses (dados de apoio)
  dados.ACUMULO_ATIVIDADES = caso.acumulo_atividades || caso.acumulo_funcao || '';
  dados.DESVIO_ATIVIDADES = caso.desvio_atividades || '';
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
  dados.tem_tomadora = temTomadora;
  dados.sem_justa_causa = tipo === 'sem_justa_causa';
  dados.rescisao_indireta = tipo === 'rescisao_indireta';
  dados.coacao_demissao = tipo === 'nulidade_pedido_demissao';
  dados.reversao_justa_causa = tipo === 'reversao_justa_causa';
  dados.tem_capitulo_rescisao = ['rescisao_indireta', 'nulidade_pedido_demissao', 'reversao_justa_causa'].includes(tipo);
  dados.aviso_reversao = tipo === 'rescisao_indireta' || tipo === 'reversao_justa_causa';
  dados.aviso_normal = tipo === 'sem_justa_causa' || tipo === 'nulidade_pedido_demissao';
  dados.acumulo_funcao = flag(caso.tem_acumulo);
  dados.desvio_funcao = flag(caso.tem_desvio);
  dados.gratificacao_funcao = flag(caso.tem_gratificacao);
  dados.escala_12x36 = /12\s*x\s*36/i.test(escalaTxt);
  dados.escala_4x2 = /\b(4\s*x\s*2|6\s*x\s*2)\b/i.test(escalaTxt);
  dados.adicional_noturno = flag(caso.tem_adic_noturno);
  dados.integracao_por_fora = flag(caso.tem_integracao_por_fora);
  dados.periculosidade = flag(caso.tem_periculosidade);
  dados.dez_minutos_cct = flag(caso.tem_dez_min_cct);
  dados.salarios_em_aberto = flag(caso.tem_salarios_aberto);
  dados.assiduidade = flag(caso.tem_assiduidade);
  dados.vale_transporte = flag(caso.tem_vale_transporte);
  dados.auxilio_alimentacao = flag(caso.tem_auxilio_alimentacao);
  dados.doenca_ocupacional = flag(caso.tem_doenca);
  dados.estabilidade_doenca = flag(caso.tem_estabilidade || caso.tem_doenca);
  dados.pensao_vitalicia = flag(caso.tem_pensao);
  dados.folgas_trabalhadas = flag(caso.tem_ft || caso.val_ft || caso.ft_qtd_media);
  dados.tem_ferias_vencidas = flag(caso.tem_ferias_vencidas);

  return dados;
}
