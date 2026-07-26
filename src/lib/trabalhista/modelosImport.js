import { base44 } from '@/api/base44Client';
import mammoth from 'mammoth';
import { traceAiCall } from '@/lib/sessionTrace';

// ============================================================
// Importação/cadastro de modelos de referência a partir de .docx:
// anonimização, extração de texto, resumo do diferencial e
// classificação leve por palavras-chave (para o matching).
// ============================================================

// Remove dados pessoais para que a IA nunca reaproveite dados de outros processos.
export function anonimizarTexto(txt) {
  if (!txt) return '';
  let t = txt;
  t = t.replace(/[\w.\-]+@[\w.\-]+\.\w+/g, '[EMAIL]');
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]');
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]');
  t = t.replace(/\bCEP:?\s*\d{5}-?\d{3}\b/gi, 'CEP: [CEP]');
  t = t.replace(/\b\d{5}-\d{3}\b/g, '[CEP]');
  t = t.replace(/(PIS:?\s*)[\d.\-]+/gi, '$1[PIS]');
  t = t.replace(/(S[ée]rie:?\s*)[\d.\-]+/gi, '$1[SERIE]');
  t = t.replace(/(CTPS:?\s*)[\d.\-]+/gi, '$1[CTPS]');
  t = t.replace(/(RG\s*(?:\/CPF\s*)?(?:n[ºo]\.?)?\s*)[\d.\-Xx]+/g, '$1[RG]');
  t = t.replace(/(nascid[oa] em\s*)\d{2}\/\d{2}\/\d{4}/gi, '$1[DATA_NASC]');
  return t;
}

// Distila de uma peça o que é PARTICULAR (diferencial), ignorando o texto padrão comum.
export async function resumirDiferencial(textoDocx) {
  const prompt = `Você recebe o texto de uma petição inicial trabalhista (modelo correto do escritório). A maior parte é texto PADRÃO, comum a quase toda petição (competência, justiça gratuita, juízo 100% digital, honorários, juros, IR, INSS, ofícios, etc.). IGNORE o padrão e extraia APENAS O QUE É PARTICULAR deste tipo de caso: modalidade de rescisão, teses/capítulos distintivos, argumentos e cláusulas específicas, e QUANDO usar. Seja objetivo (bullet points). Isso orientará a IA quando um caso semelhante aparecer.

TEXTO:
"""
${(textoDocx || '').slice(0, 40000)}
"""

Responda em português, apenas o resumo do diferencial.`;
  const request = { prompt, model: 'gemini_3_flash' };
  const r = await traceAiCall('Resumo do diferencial', request, () =>
    base44.integrations.Core.InvokeLLM(request)
  );
  return typeof r === 'string' ? r : String(r || '');
}

// Extrai o texto de um .docx real, anonimizado, para enriquecer um modelo.
export async function extrairTextoDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return anonimizarTexto(value || '');
}

// Classificação leve (para modelos NOVOS): detecta rito, teses e tomadora
// por palavras-chave, para o modelo já entrar no matching.
const TESES_KEYWORDS = [
  [/hora[s]? extra/i, 'Horas extras'],
  [/adicional noturno|hora noturna/i, 'Adicional noturno e hora noturna reduzida'],
  [/art\.?\s*71|intrajornada|intervalo (intra|para|de)/i, 'Intervalo intrajornada (art. 71 CLT)'],
  [/folga[s]? trabalhada|\bDSR\b|descanso semanal/i, 'Folgas trabalhadas/DSR'],
  [/dano[s]? moral/i, 'Dano moral'],
  [/s[uú]mula\s*331|subsidi[aá]ri|tomador/i, 'Responsabilidade subsidiária (Súm. 331 TST)'],
  [/insalubr/i, 'Insalubridade'],
  [/periculos/i, 'Adicional de periculosidade'],
  [/desvio de fun/i, 'Desvio de função'],
  [/ac[uú]mulo de fun/i, 'Acúmulo de função'],
  [/rescis[aã]o indireta|art\.?\s*483/i, 'Rescisão indireta (art. 483 CLT)'],
  [/revers[aã]o da (justa causa|dispensa)/i, 'Reversão da justa causa'],
  [/\bFGTS\b/i, 'FGTS + 40%'],
  [/verbas rescis|TRCT|aviso pr[eé]vio/i, 'Verbas rescisórias'],
];

export function classificarTextoModelo(texto) {
  const t = texto || '';
  const teses = TESES_KEYWORDS.filter(([re]) => re.test(t)).map(([, label]) => label);
  const cls = { teses, tem_tomadora: /2[ªa]\s*reclamada|tomador|s[uú]mula\s*331/i.test(t) };
  if (/sumar[ií]ss/i.test(t)) cls.rito = 'sumarissimo';
  else if (/ordin[aá]ri/i.test(t)) cls.rito = 'ordinario';
  if (/rescis[aã]o indireta|art\.?\s*483/i.test(t)) cls.tipo_dispensa = 'rescisao_indireta';
  else if (/revers[aã]o da (justa causa|dispensa)/i.test(t)) cls.tipo_dispensa = 'reversao_justa_causa';
  return cls;
}
