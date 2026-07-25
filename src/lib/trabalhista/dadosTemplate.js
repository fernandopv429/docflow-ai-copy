import { formatBRL, round2 } from './mathUtils';

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

function fmtData(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function montarQualificacao(caso = {}) {
  const partes = [
    caso.nacionalidade || 'brasileiro(a)',
    caso.estado_civil,
    caso.funcao,
    caso.recl_rg && `RG nº ${caso.recl_rg}`,
    caso.recl_cpf && `CPF nº ${caso.recl_cpf}`,
    caso.recl_pis && `PIS nº ${caso.recl_pis}`,
    caso.recl_ctps && `CTPS nº ${caso.recl_ctps}`,
    caso.recl_endereco && `residente e domiciliado(a) em ${caso.recl_endereco}`,
  ].filter(Boolean);
  return partes.join(', ');
}

const flag = (v) => !!v;

// Monta o objeto de dados para o docxtemplater.
// - VALORES: 100% determinísticos (mathUtils), a IA NÃO calcula (só audita).
// - PARTES/FLAGS: do caso estruturado (parser) + atributos.
export function montarDadosTemplate({ caso = {}, calculos = [], attrs = {}, dadosReceita = [] } = {}) {
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
  const soDigitos = (s) => (s || '').replace(/\D/g, '');
  const receita = (cnpj) => (dadosReceita || []).find((d) => d && !d.erro && soDigitos(d.cnpj) === soDigitos(cnpj));
  const r1 = receita(caso.recl1_cnpj);
  const r2 = receita(caso.recl2_cnpj);

  // 3) Partes
  dados.RECL_NOME = caso.recl_nome || '[NOME DO RECLAMANTE]';
  dados.RECL_QUALIFICACAO = montarQualificacao(caso) || '[QUALIFICAÇÃO DO RECLAMANTE]';
  dados.RITO = attrs.rito === 'sumarissimo' ? 'sumaríssimo' : 'ordinário';
  dados.FUNCAO = caso.funcao || '[FUNÇÃO]';
  dados.SALARIO = caso.salario != null ? formatBRL(caso.salario) : '[SALÁRIO]';
  dados.DATA_ADMISSAO = fmtData(caso.data_admissao) || '[DATA DE ADMISSÃO]';
  dados.DATA_RESCISAO = fmtData(caso.data_rescisao) || '[DATA DE RESCISÃO]';
  dados.DANO_MORAL_FATOS = caso.dano_fatos || caso.dano_supervisor || '';

  dados.RECL1_NOME = (r1 && r1.razao_social) || caso.recl1_nome || '[RAZÃO SOCIAL 1ª RECLAMADA]';
  dados.RECL1_CNPJ = (r1 && r1.cnpj) || caso.recl1_cnpj || '[CNPJ - confirmar]';
  dados.RECL1_ENDERECO = (r1 && r1.endereco) || caso.recl1_logradouro || '[ENDEREÇO - confirmar]';
  dados.RECL2_NOME = (r2 && r2.razao_social) || caso.recl2_nome || '';
  dados.RECL2_CNPJ = (r2 && r2.cnpj) || caso.recl2_cnpj || '';
  dados.RECL2_ENDERECO = (r2 && r2.endereco) || '';

  // 4) Flags (ligam/desligam seções no template)
  const tipo = caso.tipo_dispensa || attrs.tipo_dispensa;
  const jornada = caso.jornada_horario || '';
  dados.tem_tomadora = flag(caso.recl2_nome || attrs.tem_tomadora);
  dados.acumulo_funcao = flag(caso.tem_acumulo);
  dados.escala_12x36 = /12\s*x\s*36/i.test(jornada);
  dados.adicional_noturno = flag(caso.tem_adic_noturno);
  dados.he_100 = flag(caso.tem_ft);
  dados.assiduidade = false;
  dados.rescisao_indireta = tipo === 'rescisao_indireta';
  dados.reversao_justa_causa = tipo === 'reversao_justa_causa';
  dados.periculosidade = flag(caso.tem_periculosidade);
  dados.pensao_vitalicia = false;
  dados.estabilidade_doenca = false;

  return dados;
}
