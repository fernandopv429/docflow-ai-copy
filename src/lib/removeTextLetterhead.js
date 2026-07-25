const LETTERHEAD_MARKERS = [
  'fernando vieira advogados',
  'advocacia trabalhista',
  'www.favadvogados.com.br',
  'juridico@favadvogados.com.br',
  '(11) 3151-2816',
  'são paulo • minas gerais • brasília • santa catarina • pernambuco',
];

const normalize = (value) =>
  (value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

export function removeTextLetterhead(html) {
  if (!html || typeof DOMParser === 'undefined') return html || '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  const elements = [...document.body.querySelectorAll('p, div, span, table')];

  elements.forEach((element) => {
    const text = normalize(element.textContent);
    if (!text || text.length > 500) return;
    const isMarker = LETTERHEAD_MARKERS.some((marker) => text === marker || text.includes(marker));
    const hasContentChildren = [...element.children].some((child) => child.tagName !== 'BR');
    if (isMarker && (element.tagName !== 'DIV' || !hasContentChildren)) element.remove();
  });

  document.body.querySelectorAll('p:empty, div:empty, span:empty').forEach((element) => element.remove());
  return document.body.innerHTML.trim();
}