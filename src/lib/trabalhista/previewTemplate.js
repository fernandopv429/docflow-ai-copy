import mammoth from 'mammoth';

// ============================================================
// PREVIEW A PARTIR DO PRÓPRIO .DOCX (fonte única)
// Converte o template .docx em HTML uma única vez (mammoth), mantendo
// as tags {{CAMPO}} e as seções {{#flag}}...{{/flag}} como texto, e então
// aplica os `dados` — resolvendo seções e destacando preenchido × pendente.
// A EXPORTAÇÃO continua saindo do .docx real (docxtemplater), fiel 100%.
// ============================================================

const esqueletoCache = new Map(); // url -> HTML com as tags preservadas

export async function carregarEsqueletoTemplate(url) {
  if (!url) return '';
  if (esqueletoCache.has(url)) return esqueletoCache.get(url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Não foi possível carregar o template (HTTP ${resp.status}).`);
  const arrayBuffer = await resp.arrayBuffer();
  const { value } = await mammoth.convertToHtml({ arrayBuffer });
  const html = value || '';
  esqueletoCache.set(url, html);
  return html;
}

export function limparCacheEsqueleto(url) {
  if (url) esqueletoCache.delete(url);
  else esqueletoCache.clear();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Resolve {{#flag}}...{{/flag}} (mantém se ligado) e {{^flag}}...{{/flag}} (mantém se desligado).
function resolverSecoes(html, dados) {
  const SEC = /\{\{([#^])\s*([A-Za-z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
  let out = html || '';
  let guard = 0;
  while (SEC.test(out) && guard < 1000) {
    guard += 1;
    out = out.replace(SEC, (m, tipo, chave, inner) => {
      const ligado = !!dados?.[chave];
      const manter = tipo === '#' ? ligado : !ligado;
      return manter ? inner : '';
    });
  }
  return out;
}

// Mapeamento de marcadores [ENTRE COLCHETES] do template real -> campos de dados
const MARCADORES_COLCHETES = {
  'VARA / CIDADE / REGIÃO': 'VARA_CIDADE_REGIAO',
  'NOME DO RECLAMANTE': 'RECL_NOME',
  'ESTADO CIVIL': 'RECL_ESTADO_CIVIL',
  'FUNÇÃO': 'RECL_FUNCAO',
  'RG': 'RECL_RG',
  'CPF': 'RECL_CPF',
  'PIS': 'RECL_PIS',
  'SÉRIE': 'RECL_SERIE',
  'CTPS': 'RECL_CTPS',
  'DATA DE NASCIMENTO': 'RECL_NASCIMENTO',
  'FILIAÇÃO': 'RECL_FILIACAO',
  'ENDEREÇO DO RECLAMANTE': 'RECL_ENDERECO',
  'RAZÃO SOCIAL 1ª RECLAMADA': 'RECLAMADA1_RAZAO',
  'CNPJ - confirmar': 'RECLAMADA1_CNPJ',
  'ENDEREÇO - confirmar': 'RECLAMADA1_ENDERECO',
  'LOCAL DE PRESTAÇÃO': 'LOCAL_PRESTACAO_ENDERECO',
  'DATA DE ADMISSÃO': 'DATA_ADMISSAO',
  'DATA DE RESCISÃO': 'DATA_RESCISAO',
  'SALÁRIO': 'SALARIO',
  'DESCREVER O FATO CONCRETO DO DANO MORAL': 'DANO_MORAL_FATO_ESPECIFICO',
  'HORÁRIOS': 'JORNADA_HORARIOS',
  'ESCALA': 'ESCALA',
};

// Um valor é "pendente" quando ausente, vazio ou ainda é um marcador [ENTRE COLCHETES].
const pendente = (v) => v == null || v === '' || /^\s*\[.*\]\s*$/.test(String(v));

// Substitui marcadores [ENTRE COLCHETES] pelos valores dos dados.
function resolverColchetes(html, dados, highlight) {
  return html.replace(/\[([^\]]+)\]/g, (match, conteudo) => {
    const campo = MARCADORES_COLCHETES[conteudo.trim()];
    const v = campo ? dados[campo] : undefined;
    if (v == null || v === '' || pendente(v)) {
      return highlight ? `<mark class="tpl-pending">${escapeHtml(match)}</mark>` : escapeHtml(match);
    }
    const texto = escapeHtml(String(v)).replace(/\n/g, '<br/>');
    return highlight ? `<mark class="tpl-filled">${texto}</mark>` : texto;
  });
}

// Aplica os dados ao esqueleto. Com highlight, envolve os valores em <mark>
// (tpl-filled / tpl-pending) para revisão; sem highlight, texto puro.
// Suporta tanto {{CAMPO}} (docxtemplater) quanto [MARCADOR] (template real do escritório).
export function preencherEsqueleto(html, dados = {}, { highlight = true } = {}) {
  let out = resolverSecoes(html || '', dados);
  // Suporte a {{CAMPO}} (docxtemplater)
  out = out.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (m, chave) => {
    const v = dados[chave];
    if (pendente(v)) {
      const rotulo = v ? String(v) : `{{${chave}}}`;
      return highlight ? `<mark class="tpl-pending">${escapeHtml(rotulo)}</mark>` : escapeHtml(v ? String(v) : '');
    }
    const texto = escapeHtml(String(v)).replace(/\n/g, '<br/>');
    return highlight ? `<mark class="tpl-filled">${texto}</mark>` : texto;
  });
  // Suporte a [MARCADOR] (template nativo do escritório)
  out = resolverColchetes(out, dados, highlight);
  return out;
}

// HTML pronto para o painel de revisão.
export async function renderPreview(url, dados) {
  const esqueleto = await carregarEsqueletoTemplate(url);
  return preencherEsqueleto(esqueleto, dados, { highlight: true });
}

// Texto puro da peça resolvida — alimenta a auditoria de coerência.
export function textoDaPeca(html, dados) {
  const resolvido = preencherEsqueleto(html || '', dados, { highlight: false });
  return resolvido.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}