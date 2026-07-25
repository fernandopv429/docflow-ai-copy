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

// Um valor é "pendente" quando ausente, vazio ou ainda é um marcador [ENTRE COLCHETES].
const pendente = (v) => v == null || v === '' || /^\s*\[.*\]\s*$/.test(String(v));

// Aplica os dados ao esqueleto. Com highlight, envolve os valores em <mark>
// (tpl-filled / tpl-pending) para revisão; sem highlight, texto puro.
export function preencherEsqueleto(html, dados = {}, { highlight = true } = {}) {
  let out = resolverSecoes(html || '', dados);
  out = out.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (m, chave) => {
    const v = dados[chave];
    if (pendente(v)) {
      const rotulo = v ? String(v) : `{{${chave}}}`;
      return highlight ? `<mark class="tpl-pending">${escapeHtml(rotulo)}</mark>` : escapeHtml(v ? String(v) : '');
    }
    const texto = escapeHtml(String(v)).replace(/\n/g, '<br/>');
    return highlight ? `<mark class="tpl-filled">${texto}</mark>` : texto;
  });
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
