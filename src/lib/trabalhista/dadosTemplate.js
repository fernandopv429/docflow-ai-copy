import { formatBRL, round2 } from './mathUtils';

// ============================================================
// FONTE ÚNICA DE DADOS DA PETIÇÃO
// Monta o objeto consumido tanto pelo PREVIEW quanto pela
// EXPORTAÇÃO (docxtemplater). A IA NÃO gera o documento:
// - VALORES: 100% determinísticos (mathUtils).
// - PARTES/CONTRATO: do caso estruturado (parser) + atributos.
// - TEXTOS DO CASO: poucos trechos livres (ex.: fatos do dano moral).
// - FLAGS: ligam/desligam as seções condicionais do .docx.
// O contrato de tags está documentado em CAMPOS_TEMPLATE / FLAGS_TEMPLATE.
// ============================================================

// Mapa: rótulo do item calculado (mathUtils.calcularVerbasCaso) -> campo {{VALOR_*}}
const CALC_CAMPO = {
  'Aviso prévio indenizado': 'VALOR_AVISO_PREVIO',
  '13º proporcional': 'VALOR_13',
  'Férias proporcionais + 1/3': 'VALOR_FERIAS',
  'FGTS do período (8%)': 'VALOR_FGTS',
  'Multa de 40% do FGTS': 'VALOR_MULTA_40',
  'Dano moral (10x remuneração)': 'VALOR_DANO_MORAL',
  'Folgas trabalhadas (informado)': 'VALOR_FT',
  'Reflexo DSR sobre FT (1/6)': 'VALOR_DSR',
};

const TETO_VALOR_CAUSA = 400000;

// Documentação viva do contrato de tags (usada pelo guia e pelo preview).
export const CAMPOS_TEMPLATE = [
  'ENDERECAMENTO', 'VARA', 'COMARCA', 'REGIAO_TRT',
  'RECL_NOME', 'RECL_QUALIFICACAO', 'RECL_NACIONALIDADE', 'RECL_ESTADO_CIVIL',
  'RECL_RG', 'RECL_CPF', 'RECL_PIS', 'RECL_CTPS', 'RECL_SERIE',
  'RECL_NASCIMENTO', 'RECL_FILIACAO', 'RECL_ENDERECO',
  'RECL1_NOME', 'RECL1_CNPJ', 'RECL1_ENDERECO',
  'RECL2_NOME', 'RECL2_CNPJ', 'RECL2_ENDERECO',
  'FUNCAO', 'SALARIO', 'DATA_ADMISSAO', 'DATA_RESCISAO', 'RITO', 'JORNADA', 'SINDICATO', 'CCT',
  'DANO_MORAL_FATOS', 'CAPITULO_RESCISAO_FATOS',
  'VALOR_AVISO_PREVIO', 'VALOR_13', 'VALOR_FERIAS', 'VALOR_FGTS', 'VALOR_MULTA_40',
  'VALOR_DANO_MORAL', 'VALOR_FT', 'VALOR_DSR', 'VALOR_CAUSA',
];

export const FLAGS_TEMPLATE = [
  'tem_tomadora', 'reversao_justa_causa', 'rescisao_indireta', 'coacao_demissao',
  'acumulo_funcao', 'desvio_funcao', 'jornada_extra', 'escala_12x36', 'art_71',
  'adicional_noturno', 'dsr', 'minutos_residuais', 'dez_minutos_cct',
  'periculosidade', 'insalubridade', 'he_100', 'integracao_por_fora',
  'vale_transporte', 'auxilio_alimentacao', 'estabilidade_doenca',
  'pensao_vitalicia', 'assiduidade',
];

function fmtData(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// UF -> região do TRT (para compor o endereçamento). Cobre os principais;
// os demais caem no fallback com a própria UF.
const TRT_POR_UF = {
  SP: 'SEGUNDA REGIÃO', RJ: 'PRIMEIRA REGIÃO', MG: 'TERCEIRA REGIÃO',
  RS: 'QUARTA REGIÃO', BA: 'QUINTA REGIÃO', PE: 'SEXTA REGIÃO', CE: 'SÉTIMA REGIÃO',
  PA: 'OITAVA REGIÃO', PR: 'NONA REGIÃO', DF: 'DÉCIMA REGIÃO', AM: 'DÉCIMA PRIMEIRA REGIÃO',
  SC: 'DÉCIMA SEGUNDA REGIÃO', GO: 'DÉCIMA OITAVA REGIÃO',
};

// Descobre município/UF a partir do CEP enriquecido (define a competência).
function localPrestacao(dadosCep = []) {
  const valido = (dadosCep || []).find((d) => d && !d.erro && d.municipio);
  return valido ? { municipio: valido.municipio, uf: valido.uf } : null;
}

function montarEnderecamento(caso, local) {
  const municipio = local?.municipio || caso.comarca || null;
  const uf = (local?.uf || (caso.comarca_uf || '').slice(0, 2) || '').toUpperCase();
  if (!municipio) return { enderecamento: '', comarca: '', regiao: '' };
  const regiao = TRT_POR_UF[uf] || (uf ? `REGIÃO (${uf})` : '');
  const comarca = municipio.toUpperCase();
  return {
    enderecamento: `AO JUÍZO DA VARA DO TRABALHO DE ${comarca}${regiao ? ` – ${regiao}` : ''}`,
    comarca,
    regiao,
  };
}

function montarQualificacao(caso = {}) {
  const partes = [
    caso.recl_nacionalidade || 'brasileiro(a)',
    caso.recl_estado_civil,
    caso.funcao,
    caso.recl_rg && `RG nº ${caso.recl_rg}`,
    caso.recl_cpf && `CPF nº ${caso.recl_cpf}`,
    caso.recl_pis && `PIS nº ${caso.recl_pis}`,
    caso.recl_ctps && `CTPS nº ${caso.recl_ctps}`,
    caso.recl_serie && `Série nº ${caso.recl_serie}`,
    caso.recl_nascimento && `nascido(a) em ${fmtData(caso.recl_nascimento)}`,
    caso.recl_filiacao && `filho(a) de ${caso.recl_filiacao}`,
    caso.recl_endereco && `residente e domiciliado(a) em ${caso.recl_endereco}`,
  ].filter(Boolean);
  return partes.join(', ');
}

const flag = (v) => !!v;
const soDigitos = (s) => (s || '').replace(/\D/g, '');

export function montarDadosTemplate({ caso = {}, calculos = [], attrs = {}, dadosReceita = [], dadosCep = [] } = {}) {
  const dados = {};

  // 1) Valores exatos vindos do cálculo determinístico
  let somaCausa = 0;
  for (const c of calculos || []) {
    if (c.valor == null) continue;
    const campo = CALC_CAMPO[c.item];
    if (campo) dados[campo] = formatBRL(c.valor);
    somaCausa += Number(c.valor) || 0;
  }
  dados.VALOR_CAUSA = formatBRL(round2(Math.min(somaCausa, TETO_VALOR_CAUSA)));

  // 2) Dados oficiais de CNPJ (BrasilAPI), quando houver
  const receita = (cnpj) => (dadosReceita || []).find((d) => d && !d.erro && soDigitos(d.cnpj) === soDigitos(cnpj));
  const r1 = receita(caso.recl1_cnpj);
  const r2 = receita(caso.recl2_cnpj);

  // 3) Competência / endereçamento (do CEP do local de prestação)
  const local = localPrestacao(dadosCep);
  const { enderecamento, comarca, regiao } = montarEnderecamento(caso, local);
  dados.ENDERECAMENTO = enderecamento || '[VARA / COMARCA - confirmar]';
  dados.COMARCA = comarca || '';
  dados.REGIAO_TRT = regiao || '';
  dados.VARA = comarca ? `VARA DO TRABALHO DE ${comarca}` : '';

  // 4) Reclamante
  dados.RECL_NOME = caso.recl_nome || '[NOME DO RECLAMANTE]';
  dados.RECL_QUALIFICACAO = montarQualificacao(caso) || '[QUALIFICAÇÃO DO RECLAMANTE]';
  dados.RECL_NACIONALIDADE = caso.recl_nacionalidade || 'brasileiro(a)';
  dados.RECL_ESTADO_CIVIL = caso.recl_estado_civil || '';
  dados.RECL_RG = caso.recl_rg || '';
  dados.RECL_CPF = caso.recl_cpf || '';
  dados.RECL_PIS = caso.recl_pis || '';
  dados.RECL_CTPS = caso.recl_ctps || '';
  dados.RECL_SERIE = caso.recl_serie || '';
  dados.RECL_NASCIMENTO = fmtData(caso.recl_nascimento) || '';
  dados.RECL_FILIACAO = caso.recl_filiacao || '';
  dados.RECL_ENDERECO = caso.recl_endereco || '[ENDEREÇO DO RECLAMANTE]';

  // 5) Contrato
  dados.FUNCAO = caso.funcao || '[FUNÇÃO]';
  dados.SALARIO = caso.salario != null ? formatBRL(caso.salario) : '[SALÁRIO]';
  dados.DATA_ADMISSAO = fmtData(caso.data_admissao) || '[DATA DE ADMISSÃO]';
  dados.DATA_RESCISAO = fmtData(caso.data_rescisao) || '[DATA DE RESCISÃO]';
  dados.RITO = attrs.rito === 'sumarissimo' ? 'sumaríssimo' : 'ordinário';
  dados.JORNADA = caso.jornada_horario || '';
  dados.SINDICATO = caso.sindicato || '';
  dados.CCT = caso.cct || '';

  // 6) Reclamadas
  dados.RECL1_NOME = (r1 && r1.razao_social) || caso.recl1_nome || '[RAZÃO SOCIAL 1ª RECLAMADA]';
  dados.RECL1_CNPJ = (r1 && r1.cnpj) || caso.recl1_cnpj || '[CNPJ - confirmar]';
  dados.RECL1_ENDERECO = (r1 && r1.endereco) || caso.recl1_logradouro || '[ENDEREÇO - confirmar]';
  dados.RECL2_NOME = (r2 && r2.razao_social) || caso.recl2_nome || '';
  dados.RECL2_CNPJ = (r2 && r2.cnpj) || caso.recl2_cnpj || '';
  dados.RECL2_ENDERECO = (r2 && r2.endereco) || '';

  // 7) Textos livres do caso concreto (preenchidos pela IA no passo enxuto)
  dados.DANO_MORAL_FATOS = caso.dano_fatos || caso.dano_supervisor || '';
  dados.CAPITULO_RESCISAO_FATOS = caso.coacao_fatos || caso.rescisao_fatos || '';

  // 8) Flags — ligam/desligam seções condicionais {{#flag}}...{{/flag}}
  const tipo = caso.tipo_dispensa || attrs.tipo_dispensa;
  const jornada = caso.jornada_horario || '';
  dados.tem_tomadora = flag(caso.recl2_nome || attrs.tem_tomadora);
  dados.reversao_justa_causa = tipo === 'reversao_justa_causa';
  dados.rescisao_indireta = tipo === 'rescisao_indireta';
  dados.coacao_demissao = tipo === 'nulidade_pedido_demissao';
  dados.acumulo_funcao = flag(caso.tem_acumulo);
  dados.desvio_funcao = flag(caso.tem_desvio);
  dados.escala_12x36 = /12\s*x\s*36/i.test(jornada);
  dados.jornada_extra = flag(caso.jornada_extrapola || caso.tem_ft);
  dados.art_71 = flag(caso.tem_intervalo_suprimido || (caso.intervalo_gozado === false));
  dados.adicional_noturno = flag(caso.tem_adic_noturno);
  dados.dsr = flag(caso.tem_dsr || caso.tem_ft);
  dados.minutos_residuais = flag(caso.tem_minutos_residuais);
  dados.dez_minutos_cct = flag(caso.tem_dez_min_cct);
  dados.periculosidade = flag(caso.tem_periculosidade);
  dados.insalubridade = flag(caso.tem_insalubridade);
  dados.he_100 = flag(caso.tem_ft);
  dados.integracao_por_fora = flag(caso.tem_integracao_por_fora);
  dados.vale_transporte = flag(caso.tem_vale_transporte);
  dados.auxilio_alimentacao = flag(caso.tem_auxilio_alimentacao);
  dados.estabilidade_doenca = flag(caso.tem_estabilidade);
  dados.pensao_vitalicia = flag(caso.tem_pensao);
  dados.assiduidade = flag(caso.tem_assiduidade);

  return dados;
}
