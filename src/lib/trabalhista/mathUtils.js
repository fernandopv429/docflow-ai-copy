// Cálculos trabalhistas determinísticos (JavaScript puro).
// A IA NÃO faz aritmética: estes valores são calculados por código e
// entregues prontos ao auditor, que só valida coerência jurídica.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function formatBRL(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ============================================================
// Valor por extenso (reais/centavos) — para SALARIO_EXT / VALOR_CAUSA_EXT
// ============================================================
const UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function trioExtenso(n) {
  // n de 0 a 999
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (c) partes.push(CEM[c]);
  if (resto) {
    if (resto < 20) partes.push(UNID[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZ[d]} e ${UNID[u]}` : DEZ[d]);
    }
  }
  return partes.join(' e ');
}

function inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1000000);
  const milhares = Math.floor((n % 1000000) / 1000);
  const centenas = n % 1000;
  const partes = [];
  if (milhoes) partes.push(milhoes === 1 ? 'um milhão' : `${trioExtenso(milhoes)} milhões`);
  if (milhares) partes.push(milhares === 1 ? 'mil' : `${trioExtenso(milhares)} mil`);
  if (centenas) partes.push(trioExtenso(centenas));
  // liga o último grupo com "e" quando cabível
  if (partes.length > 1) {
    const ultimo = partes.pop();
    return `${partes.join(', ')} e ${ultimo}`;
  }
  return partes[0] || '';
}

export function numeroPorExtenso(valor) {
  const v = round2(Number(valor));
  if (v == null || isNaN(v)) return '';
  const reais = Math.floor(v);
  const centavos = Math.round((v - reais) * 100);
  const partes = [];
  if (reais > 0) partes.push(`${inteiroExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`);
  if (centavos > 0) partes.push(`${inteiroExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  if (!partes.length) return 'zero real';
  return partes.join(' e ');
}

// "R$ 2.100,00 (dois mil e cem reais)"
export function brlComExtenso(valor) {
  if (valor == null || isNaN(valor)) return '';
  return `${formatBRL(valor)} (${numeroPorExtenso(valor)})`;
}

// ============================================================
// Datas / tempo de contrato
// ============================================================
export function mesesContrato(admissao, rescisao) {
  if (!admissao || !rescisao) return null;
  const a = new Date(admissao);
  const r = new Date(rescisao);
  if (isNaN(a) || isNaN(r) || r < a) return null;
  let meses = (r.getFullYear() - a.getFullYear()) * 12 + (r.getMonth() - a.getMonth());
  if (r.getDate() >= a.getDate()) {
    if (r.getDate() - a.getDate() >= 14) meses += 1;
  }
  return Math.max(meses, 0);
}

export function anosCompletos(admissao, rescisao) {
  const m = mesesContrato(admissao, rescisao);
  return m == null ? null : Math.floor(m / 12);
}

// ============================================================
// Verbas rescisórias (Lei 12.506/2011 etc.)
// ============================================================
export function avisoPrevio(salario, anos) {
  if (!salario || anos == null) return null;
  const dias = Math.min(30 + anos * 3, 90);
  return { dias, valor: round2((salario / 30) * dias) };
}

export function decimoTerceiroProporcional(salario, meses) {
  if (!salario || meses == null) return null;
  const avos = meses % 12 || 12;
  return { avos, valor: round2((salario / 12) * avos) };
}

export function feriasProporcionais(salario, meses) {
  if (!salario || meses == null) return null;
  const avos = meses % 12 || 12;
  const base = (salario / 12) * avos;
  return { avos, valor: round2(base * (4 / 3)) };
}

export function fgtsPeriodo(salario, meses) {
  if (!salario || meses == null) return null;
  const deposito = round2(salario * 0.08 * meses);
  return { deposito, multa40: round2(deposito * 0.4) };
}

export function dsrSobreValor(valor) {
  if (!valor) return null;
  return round2(valor / 6);
}

export function danoMoral10x(maiorRemuneracao) {
  if (!maiorRemuneracao) return null;
  return round2(maiorRemuneracao * 10);
}

// ============================================================
// Consolida os cálculos possíveis a partir dos dados do caso.
// Retorna apenas itens calculáveis (inputs presentes) com rótulo + memória.
// Itens que dependem de contagem de horas (HE, noturno, art. 71, minutos)
// NÃO são estimados aqui — ficam "a apurar em liquidação" no template.
// ============================================================
export function calcularVerbasCaso(caso = {}) {
  const itens = [];
  const salario = Number(caso.salario) || null;
  const maiorRem = Number(caso.maior_remuneracao) || salario;
  const meses = mesesContrato(caso.data_admissao, caso.data_rescisao);
  const anos = meses == null ? null : Math.floor(meses / 12);
  const folgasMes = Number(caso.ft_qtd_media) || null;

  if (meses != null) {
    itens.push({ item: 'Duração do contrato', memoria: `${meses} mês(es) / ${anos} ano(s) completo(s)`, valor: null });
  }

  // Verbas rescisórias
  const ap = avisoPrevio(salario, anos);
  if (ap) itens.push({ item: 'Aviso prévio indenizado', memoria: `${ap.dias} dias (Lei 12.506/2011)`, valor: ap.valor });
  const dt = decimoTerceiroProporcional(salario, meses);
  if (dt) itens.push({ item: '13º proporcional', memoria: `${dt.avos}/12 avos`, valor: dt.valor });
  const fe = feriasProporcionais(salario, meses);
  if (fe) itens.push({ item: 'Férias proporcionais + 1/3', memoria: `${fe.avos}/12 avos + 1/3`, valor: fe.valor });
  const fg = fgtsPeriodo(salario, meses);
  if (fg) {
    itens.push({ item: 'FGTS do período (8%)', memoria: `8% × ${meses} meses`, valor: fg.deposito });
    itens.push({ item: 'Multa de 40% do FGTS', memoria: '40% sobre os depósitos', valor: fg.multa40 });
  }

  // Dano moral (10x a maior remuneração na função)
  if (caso.tem_dano_moral && maiorRem) {
    itens.push({ item: 'Dano moral (10x remuneração)', memoria: '10x a maior remuneração na função', valor: danoMoral10x(maiorRem) });
  }

  // Folgas trabalhadas (FT) — valor por folga × folgas/mês × meses; + reflexo de DSR (1/6)
  if (caso.val_ft) {
    const porFolga = Number(caso.val_ft);
    const totalFT = folgasMes && meses ? round2(porFolga * folgasMes * meses) : round2(porFolga);
    itens.push({ item: 'Folgas trabalhadas (100%)', memoria: folgasMes && meses ? `${formatBRL(porFolga)}/folga × ${folgasMes}/mês × ${meses} meses` : 'valor informado', valor: totalFT });
    const dsr = dsrSobreValor(totalFT);
    if (dsr) itens.push({ item: 'Reflexo DSR sobre FT (1/6)', memoria: 'Súm. 172 TST', valor: dsr });
  }

  // Acúmulo de função — 20% do salário por mês laborado
  if (caso.tem_acumulo && salario && meses) {
    itens.push({ item: 'Acúmulo de função (20%)', memoria: `20% × ${formatBRL(salario)} × ${meses} meses`, valor: round2(0.2 * salario * meses) });
  }

  // Bonificação de assiduidade — diferença mensal × meses
  if (caso.tem_assiduidade && caso.assiduidade_diferenca && meses) {
    const dif = Number(caso.assiduidade_diferenca);
    itens.push({ item: 'Bonificação de assiduidade (diferença)', memoria: `${formatBRL(dif)}/mês × ${meses} meses`, valor: round2(dif * meses) });
  }

  // Integração de valores pagos por fora — valor mensal × meses
  if (caso.tem_integracao_por_fora && caso.valor_por_fora && meses) {
    const vpf = Number(caso.valor_por_fora);
    itens.push({ item: 'Integração de valores por fora', memoria: `${formatBRL(vpf)}/mês × ${meses} meses`, valor: round2(vpf * meses) });
  }

  // Auxílio-alimentação nas folgas — valor/dia × folgas/mês × meses
  if (caso.tem_auxilio_alimentacao && caso.valor_aux_alimentacao && folgasMes && meses) {
    const va = Number(caso.valor_aux_alimentacao);
    itens.push({ item: 'Auxílio-alimentação nas folgas', memoria: `${formatBRL(va)}/dia × ${folgasMes}/mês × ${meses} meses`, valor: round2(va * folgasMes * meses) });
  }

  // Vale-transporte nas folgas — 2 conduções/dia × valor × folgas/mês × meses
  if (caso.tem_vale_transporte && caso.val_conducao && folgasMes && meses) {
    const vc = Number(caso.val_conducao);
    itens.push({ item: 'Vale-transporte nas folgas', memoria: `2 conduções × ${formatBRL(vc)} × ${folgasMes}/mês × ${meses} meses`, valor: round2(2 * vc * folgasMes * meses) });
  }

  return itens;
}
