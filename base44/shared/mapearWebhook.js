// Mapeamento determinístico do payload do webhook → objeto `caso`.
// Cópia backend de src/lib/trabalhista/mapearWebhook.js.

function parseBRL(s) {
  if (s == null) return null;
  const str = String(s).trim();
  const m = /R\$\s*([\d.,]+)/i.exec(str);
  const raw = m ? m[1] : str.replace(/[^\d.,]/g, '');
  if (!raw) return null;
  const v = parseFloat(raw.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function normalizarData(s) {
  if (!s) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return s.slice(0, 10);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return s;
}

function mapearTipoDispensa(s) {
  const t = String(s || '').toLowerCase().trim();
  if (/sem\s+justa\s+causa/.test(t)) return 'sem_justa_causa';
  if (/rescis[aã]o\s+indireta/.test(t)) return 'rescisao_indireta';
  if (/coa[çc][aã]o|coagido|nulidade|pedido\s+de\s+demiss[aã]o/.test(t)) return 'nulidade_pedido_demissao';
  if (/revers[aã]o\s+(da\s+)?justa\s+causa/.test(t)) return 'reversao_justa_causa';
  if (/acordo/.test(t)) return 'acordo';
  return 'sem_justa_causa';
}

function parseRange(s) {
  if (!s) return null;
  const nums = String(s).match(/\d+(?:[.,]\d+)?/g);
  if (!nums || !nums.length) return null;
  const vals = nums.map((n) => parseFloat(n.replace(',', '.')));
  if (vals.length === 1) return vals[0];
  return (vals[0] + vals[1]) / 2;
}

function extrairUF(end) {
  const s = String(end || '');
  const m = /,\s*([A-Z]{2})\s*,\s*CEP/i.exec(s) || /\/([A-Z]{2})\b/.exec(s);
  return m ? m[1] : '';
}

function inferirGenero(d) {
  const ec = String(d.estado_civil || '').toLowerCase().trim();
  if (/a$/.test(ec)) return 'F';
  if (/o$/.test(ec)) return 'M';
  return 'M';
}

export function mapearCasoDeWebhook(data) {
  if (!data || typeof data !== 'object') return {};
  const d = data;
  const caso = {};

  caso.recl_nome = d.nome_cliente || '';
  caso.recl_nacionalidade = d.nacionalidade || '';
  caso.recl_estado_civil = d.estado_civil || '';
  caso.recl_rg = d.rg || '';
  caso.recl_cpf = d.cpf || '';
  caso.recl_pis = d.pis || '';
  if (d.ctps) {
    const m = /(\d+)\s*,?\s*s[ée]rie\s*(\d+)/i.exec(d.ctps);
    if (m) { caso.recl_ctps = m[1]; caso.recl_serie = m[2]; }
    else caso.recl_ctps = d.ctps;
  }
  caso.recl_nascimento = normalizarData(d.data_nascimento);
  caso.recl_filiacao = d.filiacao || '';
  caso.recl_endereco = d.endereco_cliente || '';
  caso.recl_email = d.email || '';
  caso.recl_genero = inferirGenero(d);

  const r1 = (d.reclamadas && d.reclamadas[0]) || {};
  const r2 = (d.reclamadas && d.reclamadas[1]) || {};
  caso.recl1_nome = r1.razao_social || '';
  caso.recl1_cnpj = r1.cnpj || '';
  caso.recl1_logradouro = r1.endereco || '';
  caso.recl2_nome = r2.razao_social || '';
  caso.recl2_cnpj = r2.cnpj || '';
  caso.recl2_logradouro = r2.endereco || '';
  caso.local_prestacao = r2.endereco || r1.endereco || '';

  caso.data_admissao = normalizarData(d.admissao);
  caso.data_rescisao = normalizarData(d.demissao || d.ultimo_dia);
  caso.salario = parseBRL(d.salario);
  caso.funcao = r1.cargo || d.cargo || '';
  caso.tipo_dispensa = mapearTipoDispensa(d.tipo_dispensa);

  caso.escala = r1.escala || d.escala || '';
  if (d.horas_extras) {
    caso.jornada_extrapola = true;
    caso.jornada_freq_extra = d.media_horas_extras || '';
    const tol = [d.periodo_antecedente, d.periodo_sucedente].filter(Boolean);
    if (tol.length) caso.prorrogacao_jornada = tol.map((t) => `${t} de tolerância`).join(' — ');
  }
  if (d.intervalo_suprimido) {
    caso.intervalo_gozado = false;
    caso.intervalo_usufruido = d.intervalo_detalhes || '';
  }

  if (d.folgas_trabalhadas || d.finais_semana) {
    caso.tem_ft = true;
    caso.ft_qtd_media = parseRange(d.ft_quantidade);
  }
  if (d.ft_pagamento && /pix|dinheiro/i.test(d.ft_pagamento)) {
    caso.tem_integracao_por_fora = true;
  }

  if (d.acumulo_funcao) {
    caso.tem_acumulo = true;
    caso.acumulo_atividades = d.funcoes_acumuladas || '';
  }

  if (d.periculosidade) caso.tem_periculosidade = true;
  if (d.insalubridade) caso.tem_insalubridade = true;
  if (d.adicional_noturno) caso.tem_adic_noturno = true;

  if (d.vale_transporte) caso.tem_vale_transporte = true;
  if (d.vale_alimentacao) caso.tem_auxilio_alimentacao = true;

  if (d.doenca_acidente) caso.tem_doenca = true;
  if (d.gratificacao) caso.tem_gratificacao = true;

  caso.entrevista_texto = d.fatos_narrados || '';
  caso.dano_fatos = d.fatos_narrados || '';

  caso.comarca_uf = extrairUF(r2.endereco || r1.endereco || d.endereco_cliente);

  return caso;
}