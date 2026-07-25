// Cálculos trabalhistas determinísticos (JavaScript puro).
// A IA NÃO faz aritmética: estes valores são calculados por código e
// entregues prontos ao auditor, que só valida coerência jurídica.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function formatBRL(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Meses completos entre duas datas (mínimo 0)
export function mesesContrato(admissao, rescisao) {
  if (!admissao || !rescisao) return null;
  const a = new Date(admissao);
  const r = new Date(rescisao);
  if (isNaN(a) || isNaN(r) || r < a) return null;
  let meses = (r.getFullYear() - a.getFullYear()) * 12 + (r.getMonth() - a.getMonth());
  if (r.getDate() >= a.getDate()) {
    // mês em curso conta se ≥ 15 dias trabalhados (regra do avo)
    if (r.getDate() - a.getDate() >= 14) meses += 1;
  }
  return Math.max(meses, 0);
}

export function anosCompletos(admissao, rescisao) {
  const m = mesesContrato(admissao, rescisao);
  return m == null ? null : Math.floor(m / 12);
}

// Aviso prévio indenizado (Lei 12.506/2011): 30 dias + 3 dias por ano completo, máx. 90 dias
export function avisoPrevio(salario, anos) {
  if (!salario || anos == null) return null;
  const dias = Math.min(30 + anos * 3, 90);
  return { dias, valor: round2((salario / 30) * dias) };
}

// 13º proporcional (avos sobre os meses do contrato — estimativa p/ valor da causa)
export function decimoTerceiroProporcional(salario, meses) {
  if (!salario || meses == null) return null;
  const avos = meses % 12 || 12;
  return { avos, valor: round2((salario / 12) * avos) };
}

// Férias proporcionais + 1/3
export function feriasProporcionais(salario, meses) {
  if (!salario || meses == null) return null;
  const avos = meses % 12 || 12;
  const base = (salario / 12) * avos;
  return { avos, valor: round2(base * (4 / 3)) };
}

// FGTS do período (8% ao mês) e multa de 40%
export function fgtsPeriodo(salario, meses) {
  if (!salario || meses == null) return null;
  const deposito = round2(salario * 0.08 * meses);
  return { deposito, multa40: round2(deposito * 0.4) };
}

// Reflexo de DSR sobre verba variável habitual (1/6 — Súm. 172 TST)
export function dsrSobreValor(valor) {
  if (!valor) return null;
  return round2(valor / 6);
}

// Dano moral no padrão do escritório: 10x a maior remuneração
export function danoMoral10x(maiorRemuneracao) {
  if (!maiorRemuneracao) return null;
  return round2(maiorRemuneracao * 10);
}

// Consolida os cálculos possíveis a partir dos dados do caso.
// Retorna apenas itens calculáveis (inputs presentes) com rótulo + memória.
export function calcularVerbasCaso(caso = {}) {
  const itens = [];
  const salario = Number(caso.salario) || null;
  const meses = mesesContrato(caso.data_admissao, caso.data_rescisao);
  const anos = meses == null ? null : Math.floor(meses / 12);

  if (meses != null) {
    itens.push({ item: 'Duração do contrato', memoria: `${meses} mês(es) / ${anos} ano(s) completo(s)`, valor: null });
  }
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
  if (caso.val_ft) {
    const dsr = dsrSobreValor(Number(caso.val_ft));
    itens.push({ item: 'Folgas trabalhadas (informado)', memoria: 'valor do caso', valor: round2(Number(caso.val_ft)) });
    if (dsr) itens.push({ item: 'Reflexo DSR sobre FT (1/6)', memoria: 'Súm. 172 TST', valor: dsr });
  }
  if (caso.tem_dano_moral && salario) {
    itens.push({ item: 'Dano moral (10x remuneração)', memoria: 'padrão do escritório', valor: danoMoral10x(salario) });
  }
  return itens;
}