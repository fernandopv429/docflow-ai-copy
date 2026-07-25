export const UF_TRT_MAP = {
  AC: 'DÉCIMA QUARTA REGIÃO', AL: 'DÉCIMA NONA REGIÃO', AP: 'OITAVA REGIÃO',
  AM: 'OITAVA REGIÃO', BA: 'QUINTA REGIÃO', CE: 'SÉTIMA REGIÃO',
  DF: 'DÉCIMA REGIÃO', ES: 'DÉCIMA SÉTIMA REGIÃO', GO: 'DÉCIMA OITAVA REGIÃO',
  MA: 'DÉCIMA SEXTA REGIÃO', MT: 'DÉCIMA OITAVA REGIÃO', MS: 'VIGÉSIMA QUARTA REGIÃO',
  MG: 'TERCEIRA REGIÃO', PA: 'OITAVA REGIÃO', PB: 'DÉCIMA TERCEIRA REGIÃO',
  PR: 'NONA REGIÃO', PE: 'SEXTA REGIÃO', PI: 'VIGÉSIMA SEGUNDA REGIÃO',
  RJ: 'PRIMEIRA REGIÃO', RN: 'VIGÉSIMA PRIMEIRA REGIÃO', RS: 'QUARTA REGIÃO',
  RO: 'DÉCIMA QUARTA REGIÃO', RR: 'OITAVA REGIÃO', SC: 'DÉCIMA SEGUNDA REGIÃO',
  SP: 'SEGUNDA REGIÃO', SE: 'VIGÉSIMA REGIÃO', TO: 'VIGÉSIMA SÉTIMA REGIÃO',
};

export const TIPO_DISPENSA_LABELS = {
  sem_justa_causa: 'Dispensa sem justa causa (art. 7º, I, CF)',
  rescisao_indireta: 'Rescisão indireta (art. 483, CLT)',
  nulidade_pedido_demissao: 'Nulidade do pedido de demissão (art. 9º CLT — coação)',
  reversao_justa_causa: 'Reversão da justa causa (art. 493, CLT)',
  acordo: 'Acordo entre partes (art. 484-A, CLT)',
};

const VALORES_INVALIDOS = [
  'SIM', 'NÃO', 'NAO', 'N/A', 'NÃO INFORMADO', 'NAO INFORMADO',
  'NÃO SE APLICA', 'NAO SE APLICA', 'HABITUAL', 'FREQUENTE',
  'NÃO TEM', 'NAO TEM', '[A PREENCHER]', '[PENDÊNCIA]',
];

export function valorInvalido(valor) {
  return VALORES_INVALIDOS.includes(String(valor || '').toUpperCase().trim());
}

// Derivação determinística de tokens a partir do caso (sem IA)
export function deriveTokens(caso) {
  const uf = (caso.comarca_uf || '').toUpperCase().slice(-2);
  const tipo = caso.tipo_dispensa;
  return {
    RECL_NOME: caso.recl_nome || '',
    RECL_CPF: caso.recl_cpf || '',
    RECL_RG: caso.recl_rg || '',
    RECL_PIS: caso.recl_pis || '',
    RECL_CTPS: caso.recl_ctps || '',
    RECL_ENDERECO: caso.recl_endereco || '',
    RECL1_NOME: caso.recl1_nome || '',
    RECL1_CNPJ: caso.recl1_cnpj || '',
    RECL1_LOGRADOURO: caso.recl1_logradouro || '',
    RECL1_ENDCOMPL: caso.recl1_complemento || '',
    RECL2_NOME: caso.recl2_nome || '',
    RECL2_CNPJ: caso.recl2_cnpj || '',
    RECL3_NOME: caso.recl3_nome || '',
    RECL3_CNPJ: caso.recl3_cnpj || '',
    FUNCAO: caso.funcao || '',
    SALARIO: caso.salario != null ? String(caso.salario) : '',
    DATA_ADMISSAO: caso.data_admissao || '',
    DATA_RESCISAO: caso.data_rescisao || '',
    JORNADA_HORARIO: caso.jornada_horario || '',
    COMARCA_UF: uf,
    REGIAO_TRT: UF_TRT_MAP[uf] || '',
    VAL_FT: caso.val_ft != null ? String(caso.val_ft) : '',
    FT_QTD_MEDIA: caso.ft_qtd_media != null ? String(caso.ft_qtd_media) : '',
    DANO_FATOS: caso.dano_fatos || '',
    DANO_SUPERVISOR: caso.dano_supervisor || '',
    // Narrativa dos fatos que fundamentam a modalidade de rescisão (usada dentro
    // do bloco condicional T_INDIRETA/T_REVERSAO/T_COACAO/T_ACORDO no Modelo Padrão)
    MOTIVO_RESCISAO_FATOS: caso.motivo_rescisao_fatos || '',
    ACUMULO_FUNCAO: caso.acumulo_funcao || '',
    TIPO_DISPENSA: TIPO_DISPENSA_LABELS[tipo] || '',
    // Flags condicionais consumidas por {{#if T_X}}...{{/if}} no Modelo Padrão
    // (ver applyConditionals em exportDocx.js). Mutuamente exclusivas.
    T_DISPENSA: tipo === 'sem_justa_causa',
    T_INDIRETA: tipo === 'rescisao_indireta',
    T_COACAO: tipo === 'nulidade_pedido_demissao',
    T_REVERSAO: tipo === 'reversao_justa_causa',
    T_ACORDO: tipo === 'acordo',
    tem_ft: !!(caso.tem_ft || caso.val_ft),
    tem_dano_moral: !!(caso.dano_fatos || caso.dano_supervisor || caso.dano_sem_estrutura),
  };
}

const OBRIGATORIOS = [
  ['recl_nome', 'Nome do reclamante'],
  ['recl1_nome', 'Nome da 1ª reclamada'],
  ['recl1_cnpj', 'CNPJ da 1ª reclamada'],
  ['comarca_uf', 'Comarca/UF'],
  ['data_admissao', 'Data de admissão'],
  ['tipo_dispensa', 'Modalidade de rescisão'],
];

const PADROES = [
  ['recl_cpf', /^\d{11}$/, 'CPF deve ter 11 dígitos'],
  ['recl1_cnpj', /^\d{14}$/, 'CNPJ deve ter 14 dígitos'],
  ['comarca_uf', /^[A-Za-z]{2}$/, 'UF deve ter 2 letras'],
];

// Retorna lista de pendências (vazia = válido)
export function validarCaso(caso) {
  const pendencias = [];
  for (const [campo, label] of OBRIGATORIOS) {
    if (!caso[campo] || valorInvalido(caso[campo])) pendencias.push(`${label} não preenchido(a) ou inválido(a)`);
  }
  for (const [campo, regex, msg] of PADROES) {
    if (caso[campo] && !regex.test(String(caso[campo]))) pendencias.push(msg);
  }
  const tokens = deriveTokens(caso);
  if (tokens.tem_ft && !tokens.FT_QTD_MEDIA) pendencias.push('FT_QTD_MEDIA não informada (obrigatória quando há folgas trabalhadas)');
  if (tokens.COMARCA_UF && !tokens.REGIAO_TRT) pendencias.push('REGIAO_TRT não derivada — verifique a UF');
  return pendencias;
}