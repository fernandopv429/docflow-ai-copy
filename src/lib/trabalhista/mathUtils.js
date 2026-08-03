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
// Conversão determinística, no padrão das petições do escritório (ex.: "vinte
// e um mil, quatrocentos e oitenta e dois reais e vinte centavos"). Suporta
// até centenas de milhões. Elimina divergência entre número e texto por
// extenso (a IA NÃO escreve por extenso — só o código).
// ============================================================
const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function grupoPorExtenso(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 10) partes.push(UNIDADES[resto]);
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1000000);
  const milhares = Math.floor((n % 1000000) / 1000);
  const centenas = n % 1000;
  const partes = [];
  if (milhoes) partes.push(milhoes === 1 ? 'um milhão' : `${grupoPorExtenso(milhoes)} milhões`);
  if (milhares) partes.push(milhares === 1 ? 'mil' : `${grupoPorExtenso(milhares)} mil`);
  if (centenas) partes.push(grupoPorExtenso(centenas));
  return partes.join(', ');
}

// Converte valor em reais para a frase por extenso completa (reais + centavos
// no plural/singular corretos). Cálculo de centavos via Math.round(*100) —
// robusto a erro de ponto flutuante que afetava a versão anterior.
export function valorPorExtenso(valor) {
  const centavosTotais = Math.round((Number(valor) || 0) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const centavosTxt = centavos ? `${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}` : '';
  if (!reais) return centavosTxt || 'zero reais';
  const reaisTxt = `${inteiroPorExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`;
  return centavos ? `${reaisTxt} e ${centavosTxt}` : reaisTxt;
}

// Alias p/ compatibilidade (callers antigos)
export const numeroPorExtenso = valorPorExtenso;

// "R$ 2.100,00 (dois mil e cem reais)"
export function brlComExtenso(valor) {
  if (valor == null || isNaN(valor)) return '';
  return `${formatBRL(valor)} (${valorPorExtenso(valor)})`;
}

// ============================================================
// Datas / tempo de contrato
// ============================================================
export function mesesContrato(admissao, rescisao) {
  if (!admissao || !rescisao) return null;
  const a = new Date(admissao);
  const r = new Date(rescisao);
  if (isNaN(a.getTime()) || isNaN(r.getTime()) || r < a) return null;
  // Mês (avo) conta quando há 15 dias ou mais de presença. Contagem mês a
  // mês (mesma base do avosEntreDatas), sem cap, para contratos longos (>12
  // meses) serem computados corretamente no FGTS/acúmulo/desvio/etc. O
  // atalho anterior (diff de dias >= 14) falhava quando o dia da rescisão
  // era anterior ao da admissão, superestimando os meses.
  let meses = 0;
  const inicioMs = new Date(a.getFullYear(), a.getMonth(), 1).getTime();
  const fimMs = new Date(r.getFullYear(), r.getMonth(), 1).getTime();
  const cursor = new Date(a.getFullYear(), a.getMonth(), 1);
  while (cursor.getTime() <= fimMs) {
    const mesEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const start = cursor.getTime() === inicioMs ? a : new Date(cursor);
    const end = cursor.getTime() === fimMs ? r : mesEnd;
    const dias = Math.floor((end - start) / 86400000) + 1;
    if (dias >= 15) meses += 1;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return Math.max(meses, 0);
}

export function anosCompletos(admissao, rescisao) {
  const m = mesesContrato(admissao, rescisao);
  return m == null ? null : Math.floor(m / 12);
}

// Projeta a data de rescisão pelos dias do aviso prévio INDENIZADO. O aviso
// prévio (trabalhado ou indenizado) integra o tempo de serviço do empregado
// para todos os efeitos legais (art. 487, §1º, da CLT; Súmula 371 do C. TST),
// de modo que 13º, férias proporcionais e FGTS do período devem ser apurados
// já computando esses dias adicionais — NÃO apenas a data "seca" da rescisão.
// (Isso NÃO altera os próprios dias do aviso prévio, que continuam calculados
// sobre os anos completos até a data real de rescisão.)
// Recebe os DIAS efetivamente indenizados (ap.dias) — na rescisão por acordo
// (art. 484-A, I, CLT) o aviso é pago pela metade, e a projeção deve usar essa
// metade para não superestimar 13º/férias/FGTS.
export function projetarDataComAvisoPrevio(rescisao, diasAviso) {
  if (!rescisao || !diasAviso) return rescisao;
  const r = new Date(rescisao);
  if (isNaN(r.getTime())) return rescisao;
  r.setDate(r.getDate() + diasAviso);
  return r.toISOString().slice(0, 10);
}

// Conta avos (1/12) entre admissão e a data final (atual ou projetada).
// Mês conta se ≥15 dias de presença (trabalhada ou projetada pelo aviso).
// contarProjecaoUltimoMes=true → o último mês (projetado pelo aviso indenizado)
// conta mesmo com <15 dias (aplicável ao 13º; férias usa false).
export function avosEntreDatas(admissao, dataFinal, contarProjecaoUltimoMes) {
  if (!admissao || !dataFinal) return null;
  const a = new Date(admissao);
  const r = new Date(dataFinal);
  if (isNaN(a.getTime()) || isNaN(r.getTime()) || r < a) return null;
  let avos = 0;
  const cursor = new Date(a.getFullYear(), a.getMonth(), 1);
  const ultimoMes = new Date(r.getFullYear(), r.getMonth(), 1);
  const mesAdmissao = new Date(a.getFullYear(), a.getMonth(), 1).getTime();
  while (cursor <= ultimoMes) {
    const mesEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const efetivoStart = cursor.getTime() === mesAdmissao ? a : new Date(cursor);
    const ehUltimo = cursor.getTime() === ultimoMes.getTime();
    const efetivoEnd = ehUltimo ? r : mesEnd;
    const dias = Math.floor((efetivoEnd - efetivoStart) / 86400000) + 1;
    if (dias >= 15 || (ehUltimo && contarProjecaoUltimoMes)) avos += 1;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return Math.min(avos, 12);
}

// ============================================================
// Verbas rescisórias (Lei 12.506/2011 etc.)
// ============================================================
// Aviso prévio indenizado: 30 dias + 3 por ano completo, máx. 90 dias.
// Na rescisão por acordo (art. 484-A, I, CLT) é pago pela METADE.
export function avisoPrevio(salario, anos, { acordo = false } = {}) {
  if (!salario || anos == null) return null;
  const diasIntegral = Math.min(30 + anos * 3, 90);
  const dias = acordo ? Math.round(diasIntegral / 2) : diasIntegral;
  return { dias, diasIntegral, valor: round2((salario / 30) * dias) };
}

// Saldo de salário do mês da rescisão (dias do mês ÷ 30 × salário — mês
// comercial de 30 dias, padrão na prática trabalhista). Verba incontroversa.
export function saldoSalario(salario, dataRescisao) {
  if (!salario || !dataRescisao) return null;
  const r = new Date(dataRescisao);
  if (isNaN(r.getTime())) return null;
  const dias = r.getDate();
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

// FGTS do período (8%/mês) + multa rescisória. Multa padrão 40%; na rescisão
// por acordo (art. 484-A, II, CLT) é 20% — passe { multaPct: 0.2 }.
export function fgtsPeriodo(salario, meses, { multaPct = 0.4 } = {}) {
  if (!salario || meses == null) return null;
  const deposito = round2(salario * 0.08 * meses);
  const multa = round2(deposito * multaPct);
  return { deposito, multa, multa40: multa, multaPct };
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
  // Rescisão por acordo (art. 484-A CLT): aviso prévio pela metade e multa do
  // FGTS de 20%. O 13º e as férias proporcionais permanecem INTEGRAIS.
  const isAcordo = caso.tipo_dispensa === 'acordo';

  if (meses != null) {
    itens.push({ item: 'Duração do contrato', memoria: `${meses} mês(es) / ${anos} ano(s) completo(s)`, valor: null });
  }

  // Saldo de salário do mês da rescisão (verba rescisória incontroversa).
  const saldo = saldoSalario(salario, caso.data_rescisao);
  if (saldo) itens.push({ item: 'Saldo de salário', memoria: `${saldo.dias} dia(s) do mês da rescisão (base 30)`, valor: saldo.valor });

  // Verbas rescisórias — 13º e férias usam a data PROJETADA pelo aviso prévio
  const ap = avisoPrevio(salario, anos, { acordo: isAcordo });
  if (ap) {
    const memoriaAp = isAcordo
      ? `${ap.dias} dias — metade de ${ap.diasIntegral} (art. 484-A, I, CLT — acordo)`
      : `${ap.dias} dias (Lei 12.506/2011)`;
    itens.push({ item: 'Aviso prévio indenizado', memoria: memoriaAp, valor: ap.valor });
  }
  // Projeção do aviso prévio: usa os DIAS efetivamente indenizados (ap.dias),
  // que no acordo é a METADE — garante que 13º/férias/FGTS não sejam
  // superestimados na rescisão por acordo (art. 484-A, I, CLT).
  const dataFim = ap ? (projetarDataComAvisoPrevio(caso.data_rescisao, ap.dias) || caso.data_rescisao) : caso.data_rescisao;
  // Meses COM a projeção do aviso — usados no FGTS (Súm. 305/371 TST: o aviso
  // prévio indenizado integra o tempo de serviço, inclusive para FGTS).
  const mesesProjetados = mesesContrato(caso.data_admissao, dataFim) ?? meses;
  // 13º: mês conta só se ≥15 dias. A projeção do aviso só amplia a data final;
  // o último mês projetado NÃO é forçado (6 dias em jan. NÃO viram 1/12).
  const avos13 = salario ? avosEntreDatas(caso.data_admissao, dataFim, false) : null;
  const valor13 = avos13 != null ? round2((salario / 12) * avos13) : null;
  if (valor13 != null) itens.push({ item: '13º proporcional', memoria: `${avos13}/12 avos (proj. aviso prévio)`, valor: valor13 });
  // Férias: período aquisitivo — só conta mês com ≥15 dias (projeção não força o último mês)
  const avosFerias = salario ? avosEntreDatas(caso.data_admissao, dataFim, false) : null;
  const valorFerias = avosFerias != null ? round2((salario / 12) * avosFerias * (4 / 3)) : null;
  if (valorFerias != null) itens.push({ item: 'Férias proporcionais + 1/3', memoria: `${avosFerias}/12 avos + 1/3 (proj. aviso prévio)`, valor: valorFerias });

  // Multa do art. 467 da CLT: 50% sobre as verbas rescisórias INCONTROVERSAS
  // (saldo + aviso prévio + 13º + férias +1/3), não apenas "1 salário".
  if (ap && valor13 != null && valorFerias != null) {
    const baseIncontroversa = round2((saldo?.valor || 0) + ap.valor + valor13 + valorFerias);
    itens.push({ item: 'Multa do art. 467 da CLT', memoria: '50% sobre saldo + aviso prévio + 13º + férias +1/3 (verbas incontroversas)', valor: round2(baseIncontroversa * 0.5) });
  }

  // Multa do art. 477 da CLT — 1 salário nominal (§§ 6º e 8º), devida quando
  // as verbas rescisórias não são pagas no prazo. Presume-se na rescisão não
  // quitada (todas as petições de referência a pedem).
  if (ap && salario) {
    itens.push({ item: 'Multa do art. 477 da CLT', memoria: '1 salário nominal (art. 477, §§ 6º e 8º, CLT)', valor: round2(salario) });
  }

  // Salários em aberto — meses não quitados × salário (nº de meses informado)
  if (caso.tem_salarios_aberto && salario) {
    const qtd = Number(caso.salarios_aberto_qtd);
    if (qtd > 0) {
      itens.push({ item: 'Salários em aberto', memoria: `${qtd} mês(es) não quitado(s) × ${formatBRL(salario)}`, valor: round2(salario * qtd) });
    }
  }

  const fg = fgtsPeriodo(salario, mesesProjetados, { multaPct: isAcordo ? 0.2 : 0.4 });
  if (fg) {
    itens.push({ item: 'FGTS do período (8%)', memoria: `8% × ${mesesProjetados} meses (proj. aviso prévio)`, valor: fg.deposito });
    itens.push({
      item: isAcordo ? 'Multa de 20% do FGTS (acordo)' : 'Multa de 40% do FGTS',
      memoria: isAcordo ? '20% sobre os depósitos (art. 484-A, II, CLT — acordo)' : '40% sobre os depósitos',
      valor: fg.multa,
    });
  }

  // Dano moral (10x a maior remuneração na função).
  // A flag tem_dano_moral pode ser desativada pelo validador do parser
  // (dano_fatos vazio/curto), mas a narrativa do dano moral é sempre gerada
  // no template (sem condicional). Dispara o cálculo também quando há
  // conteúdo de dano moral (fatos/supervisor) ou teses que o fundamentam.
  const temConteudoDanoMoral = caso.tem_dano_moral
    || (caso.dano_fatos && String(caso.dano_fatos).trim().length >= 20)
    || (caso.dano_supervisor && String(caso.dano_supervisor).trim().length >= 20)
    || caso.tem_desvio
    || (caso.tem_ft && caso.tem_integracao_por_fora)
    || caso.tem_insalubridade;
  if (temConteudoDanoMoral && maiorRem) {
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

  // Gratificação/bônus de função — valor fixo mensal (diversos CCTs) ou
  // 10% do salário (cláusula 3ª CCT vigilância, fallback quando sem valor)
  if (caso.tem_gratificacao && meses) {
    const gratVal = Number(caso.gratificacao_valor);
    if (gratVal > 0) {
      itens.push({ item: 'Gratificação/bônus de função', memoria: `${formatBRL(gratVal)}/mês × ${meses} meses`, valor: round2(gratVal * meses) });
    } else if (salario) {
      itens.push({ item: 'Gratificação de função (10%)', memoria: `10% × ${formatBRL(salario)} × ${meses} meses (cláusula 3ª)`, valor: round2(0.1 * salario * meses) });
    }
  }

  // Desvio de função — multa convencional de 50% do salário por mês (cláusula 64ª)
  if (caso.tem_desvio && salario && meses) {
    itens.push({ item: 'Desvio de função (50%)', memoria: `50% × ${formatBRL(salario)} × ${meses} meses (cláusula 64ª)`, valor: round2(0.5 * salario * meses) });
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

  // Vale-transporte nas folgas — 2 conduções/dia × valor × folgas/mês × meses.
  // Fallback determinístico: quando o valor não for informado na entrevista,
  // adota-se R$ 5,00 por condução (R$ 10,00/dia) — padrão do escritório.
  if (caso.tem_vale_transporte && folgasMes && meses) {
    const vc = Number(caso.val_conducao) || 5;
    const usouPadrao = !caso.val_conducao;
    const memoria = usouPadrao
      ? `2 conduções × R$ 5,00 (padrão — valor não informado) × ${folgasMes}/mês × ${meses} meses`
      : `2 conduções × ${formatBRL(vc)} × ${folgasMes}/mês × ${meses} meses`;
    itens.push({ item: 'Vale-transporte nas folgas', memoria, valor: round2(2 * vc * folgasMes * meses) });
  }

  // Honorários advocatícios sucumbenciais — 15% sobre o valor da causa (art.
  // 85 do CPC), integrantes do valor da causa perante o art. 292, I, do CPC.
  // Cálculo determinístico (a IA não o faz); deve figurar de forma uniforme no
  // tópico, no rol de pedidos e no fecho, conforme diretriz do escritório.
  const somaVerbas = round2(itens.reduce((s, c) => s + (Number(c.valor) || 0), 0));
  if (somaVerbas > 0) {
    itens.push({ item: 'Honorários advocatícios (15%)', memoria: '15% sobre o valor da causa (art. 85 do CPC)', valor: round2(somaVerbas * 0.15) });
  }

  return itens;
}