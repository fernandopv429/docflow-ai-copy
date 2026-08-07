// ============================================================
// Mapeamento determinístico do payload do webhook (evento
// "entrevista.salva", disparado pelo app Entrevista Digital) para
// o objeto `caso` usado pelo motor de geração (dadosTemplate/mathUtils).
// Como o webhook já entrega dados estruturados, o motor pula a
// extração por IA e usa este caso direto — mais rápido, mais barato
// e sem risco de reextração.
//
// Contrato de entrada = campos do entity `Entrevista` do app
// "Entrevista Digital" (RECL_NOME, RECL1_NOME, DATA_ADMISSAO, FUNCAO,
// escala, etc. — nomes de tag, não nomes de banco). Se o formulário
// mudar de novo, ajustar aqui.
// ============================================================

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

const TIPOS_DISPENSA_VALIDOS = [
  'sem_justa_causa', 'rescisao_indireta', 'nulidade_pedido_demissao', 'reversao_justa_causa', 'acordo',
];

function mapearTipoDispensa(s) {
  const raw = String(s || '').toLowerCase().trim();
  if (TIPOS_DISPENSA_VALIDOS.includes(raw)) return raw; // já vem no enum canônico do formulário
  const t = raw.replace(/_/g, ' '); // aceita também texto livre/rótulo humano
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
  return m ? m[1].toUpperCase() : '';
}

function inferirGenero(estadoCivil) {
  const ec = String(estadoCivil || '').toLowerCase().trim();
  if (/a$/.test(ec)) return 'F';
  if (/o$/.test(ec)) return 'M';
  return 'M';
}

function juntarEndereco(logradouro, complemento) {
  return [logradouro, complemento].filter(Boolean).join(', ');
}

export function mapearCasoDeWebhook(data) {
  if (!data || typeof data !== 'object') return {};
  const d = data;
  const caso = {};

  // Reclamante
  caso.recl_nome = d.RECL_NOME || '';
  caso.recl_nacionalidade = d.RECL_NACIONALIDADE || '';
  caso.recl_estado_civil = d.RECL_ESTADOCIVIL || '';
  caso.recl_rg = d.RECL_RG || '';
  caso.recl_cpf = d.RECL_CPF || '';
  caso.recl_pis = d.RECL_PIS || '';
  caso.recl_ctps = d.RECL_CTPS || '';
  caso.recl_serie = d.RECL_SERIE || '';
  caso.recl_nascimento = normalizarData(d.RECL_NASC);
  caso.recl_filiacao = d.RECL_FILIACAO || '';
  caso.recl_endereco = d.RECL_CEP ? `${d.RECL_ENDERECO || ''}, CEP ${d.RECL_CEP}` : (d.RECL_ENDERECO || '');
  caso.recl_email = d.email || '';
  caso.recl_genero = inferirGenero(d.RECL_ESTADOCIVIL);

  // Reclamadas (o formulário atual é plano — sem array `reclamadas`)
  caso.recl1_nome = d.RECL1_NOME || '';
  caso.recl1_cnpj = d.RECL1_CNPJ || '';
  caso.recl1_logradouro = juntarEndereco(d.RECL1_LOGRADOURO, d.RECL1_ENDCOMPL);
  caso.recl2_nome = d.RECL2_NOME || '';
  caso.recl2_cnpj = d.RECL2_CNPJ || '';
  caso.recl2_logradouro = juntarEndereco(d.RECL2_LOGRADOURO, d.RECL2_ENDCOMPL);
  caso.recl3_nome = d.RECL3_NOME || '';
  caso.recl3_cnpj = d.RECL3_CNPJ || '';
  // Local de prestação = tomadora (2ª reclamada) quando houver, senão empregadora
  caso.local_prestacao = caso.recl2_logradouro || caso.recl1_logradouro || '';

  // Contrato
  caso.data_admissao = normalizarData(d.DATA_ADMISSAO);
  caso.data_rescisao = normalizarData(d.DATA_RESCISAO);
  caso.salario = parseBRL(d.salario ?? d.SALARIO); // form atual não pede salário; vira piso normativo da CCT (enriquecerCct)
  caso.funcao = d.FUNCAO || '';
  caso.tipo_dispensa = mapearTipoDispensa(d.tipo_dispensa);

  // Jornada
  caso.escala = d.escala || '';
  caso.jornada_horario = d.JORNADA_HORARIO || '';
  if (d.horas_extras) {
    caso.jornada_extrapola = true;
    caso.jornada_freq_extra = d.media_horas_extras || '';
    const tol = [d.periodo_antecedente, d.periodo_sucedente].filter(Boolean);
    if (tol.length) caso.prorrogacao_jornada = tol.map((t) => `${t} de tolerância`).join(' — ');
  }
  if (d.intervalo_suprimido) {
    caso.intervalo_gozado = false;
    caso.intervalo_usufruido = d.INTERVALO_GOZADO || '';
  }

  // Folgas trabalhadas (FT)
  if (d.folgas_trabalhadas || d.finais_semana) {
    caso.tem_ft = true;
    caso.ft_qtd_media = parseRange(d.FT_QTD_MEDIA);
    caso.val_ft = parseRange(d.VAL_FT);
  }
  if (d.ft_pagamento && /pix|dinheiro/i.test(d.ft_pagamento)) {
    caso.tem_integracao_por_fora = true;
  }

  // Acúmulo de função
  if (d.acumulo_funcao) {
    caso.tem_acumulo = true;
    caso.acumulo_atividades = d.funcoes_acumuladas || '';
  }

  // Adicionais
  if (d.tem_periculosidade) caso.tem_periculosidade = true;
  if (d.tem_insalubridade) caso.tem_insalubridade = true;

  // Benefícios
  if (d.vale_transporte) caso.tem_vale_transporte = true;
  if (d.vale_alimentacao || d.vale_refeicao) caso.tem_auxilio_alimentacao = true;

  // Doença / gratificação
  if (d.tem_doenca) caso.tem_doenca = true;
  if (d.gratificacao) caso.tem_gratificacao = true;

  // Textos livres (fatos narrados → entrevista + dano moral)
  caso.entrevista_texto = d.fatos_narrados || '';
  caso.dano_fatos = d.fatos_narrados || '';

  // Comarca/UF (inferida do endereço da tomadora/empregadora)
  caso.comarca_uf = extrairUF(caso.recl2_logradouro || caso.recl1_logradouro || caso.recl_endereco);

  return caso;
}
