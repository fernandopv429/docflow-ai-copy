import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  UnderlineType,
  Header,
  Footer,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageNumber,
  ImageRun,
} from 'docx';
import { applyConditionals } from './variables';
import { removeTextLetterhead } from './removeTextLetterhead';
import { TIMBRADO } from './timbrado';
import { sessionTrace } from './sessionTrace';

// ---------- Utilitarios de parsing HTML -> docx ----------

function getAlignment(el) {
  const alignment = cssValues(el)['text-align'];
  if (alignment === 'center') return AlignmentType.CENTER;
  if (alignment === 'right' || alignment === 'end') return AlignmentType.RIGHT;
  if (alignment === 'justify') return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

const COMPUTED_STYLE_KEYS = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-decoration',
  'text-align', 'text-indent', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
  'line-height', 'page-break-before', 'page-break-after', 'break-before', 'break-after',
  'vertical-align',
];

function cssValues(el) {
  const values = {};
  if (el?.isConnected && typeof window !== 'undefined') {
    const computed = window.getComputedStyle(el);
    COMPUTED_STYLE_KEYS.forEach((key) => { values[key] = computed.getPropertyValue(key); });
  }
  const raw = (el?.getAttribute && el.getAttribute('style')) || '';
  raw.split(';').forEach((part) => {
    const index = part.indexOf(':');
    if (index > -1) values[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim();
  });
  return values;
}

function cssNumber(value) {
  const match = String(value || '').match(/-?[\d.]+/);
  return match ? Number(match[0]) : undefined;
}

function toTwips(value) {
  const number = cssNumber(value);
  if (!Number.isFinite(number)) return undefined;
  const unit = String(value || '').toLowerCase();
  if (unit.includes('px')) return Math.round(number * 15);
  if (unit.includes('cm')) return Math.round(number * 567);
  if (unit.includes('mm')) return Math.round(number * 56.7);
  if (unit.includes('in')) return Math.round(number * 1440);
  return Math.round(number * 20);
}

function toHalfPoints(value) {
  const number = cssNumber(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.round(number * (String(value || '').toLowerCase().includes('px') ? 1.5 : 2));
}

function docxColor(value, fallback) {
  const raw = String(value || '').trim();
  const hex = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex) return hex[1].toUpperCase();
  const shortHex = raw.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) return shortHex[1].split('').map((char) => char + char).join('').toUpperCase();
  const rgb = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return rgb.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('').toUpperCase();
  return fallback;
}

function inlineStyle(el, inherited = {}) {
  const css = cssValues(el);
  const decoration = css['text-decoration'] || '';
  const verticalAlign = css['vertical-align'];
  return {
    ...inherited,
    font: css['font-family']?.replace(/["']/g, '').split(',')[0] || inherited.font || 'Arial',
    size: toHalfPoints(css['font-size']) || inherited.size || 24,
    bold: /bold|[6-9]00/.test(css['font-weight'] || '') || inherited.bold || false,
    italics: css['font-style'] === 'italic' || inherited.italics || false,
    underline: decoration.includes('underline') || inherited.underline || false,
    strike: decoration.includes('line-through') || inherited.strike || false,
    subScript: verticalAlign === 'sub' || inherited.subScript || false,
    superScript: verticalAlign === 'super' || inherited.superScript || false,
    color: docxColor(css.color, inherited.color),
  };
}

function processInlineNodes(node, style = {}) {
  const runs = [];
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) runs.push(new TextRun({
        text: child.textContent,
        font: style.font || 'Arial',
        size: style.size || 24,
        bold: style.bold || false,
        italics: style.italics || false,
        color: style.color,
        strike: style.strike || false,
        subScript: style.subScript || false,
        superScript: style.superScript || false,
        underline: style.underline ? { type: UnderlineType.SINGLE } : undefined,
      }));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      const next = inlineStyle(child, style);
      if (tag === 'strong' || tag === 'b') next.bold = true;
      if (tag === 'em' || tag === 'i') next.italics = true;
      if (tag === 'u') next.underline = true;
      if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true;
      if (tag === 'sub') next.subScript = true;
      if (tag === 'sup') next.superScript = true;
      if (tag === 'br') { runs.push(new TextRun({ break: 1 })); continue; }
      runs.push(...processInlineNodes(child, next));
    }
  }
  return runs;
}

function buildTable(tableEl) {
  const rows = [];
  const htmlRows = tableEl.querySelectorAll('tr');
  htmlRows.forEach((tr) => {
    const cells = [];
    const htmlCells = tr.querySelectorAll('th, td');
    htmlCells.forEach((cellEl) => {
      const isHeader = cellEl.tagName.toLowerCase() === 'th';
      const runs = processInlineNodes(cellEl, isHeader ? { bold: true } : {});
      cells.push(new TableCell({
        children: [new Paragraph({ children: runs, alignment: getAlignment(cellEl) })],
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
      }));
    });
    if (cells.length) rows.push(new TableRow({ children: cells }));
  });
  if (!rows.length) return null;
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    },
  });
}

function isPageBreak(el) {
  const css = cssValues(el);
  return ['always', 'page'].includes(css['page-break-before']) ||
    ['always', 'page'].includes(css['page-break-after']) ||
    css['break-before'] === 'page' || css['break-after'] === 'page';
}

function processBlock(block, out, state) {
  const tag = block.tagName ? block.tagName.toLowerCase() : '';
  if (!tag || ['style', 'script', 'meta', 'link'].includes(tag)) return;
  const css = cssValues(block);

  if (tag === 'section' && block.classList?.contains('docx')) {
    if (state.pageCount > 0) out.push(new Paragraph({ pageBreakBefore: true, children: [] }));
    state.pageCount += 1;
  } else if (isPageBreak(block)) {
    out.push(new Paragraph({ pageBreakBefore: true, children: [] }));
  }

  if (tag === 'table') {
    const table = buildTable(block);
    if (table) out.push(table);
    return;
  }
  if (tag === 'ul' || tag === 'ol') {
    for (const li of block.children) {
      out.push(new Paragraph({
        children: processInlineNodes(li, inlineStyle(li)),
        ...(tag === 'ul' ? { bullet: { level: 0 } } : { numbering: { reference: 'doc-numbering', level: 0 } }),
      }));
    }
    return;
  }
  if (['div', 'section', 'article'].includes(tag) && block.children?.length) {
    for (const child of block.children) processBlock(child, out, state);
    return;
  }

  const heading = ['h1', 'h2', 'h3'].includes(tag);
  const runs = processInlineNodes(block, inlineStyle(block, { bold: heading }));
  const firstLine = toTwips(css['text-indent']);
  const left = toTwips(css['margin-left']);
  const right = toTwips(css['margin-right']);
  const before = toTwips(css['margin-top']);
  const after = toTwips(css['margin-bottom']);
  const lineRatio = (() => {
    const raw = css['line-height'];
    const numero = cssNumber(raw);
    if (!Number.isFinite(numero) || numero <= 0) return undefined;
    let ratio;
    if (/px|pt|cm|mm|in/i.test(String(raw))) {
      const lhTwips = toTwips(raw);
      const fsTwips = toTwips(css['font-size']);
      if (!lhTwips || !fsTwips) return undefined;
      ratio = lhTwips / fsTwips;
    } else if (/%/.test(String(raw))) {
      ratio = numero / 100;
    } else {
      ratio = numero; // multiplicador sem unidade (ex.: 1.5)
    }
    return Math.min(3, Math.max(1, ratio));
  })();
  const alignment = getAlignment(block);
  out.push(new Paragraph({
    children: runs,
    alignment: alignment === AlignmentType.LEFT ? AlignmentType.JUSTIFIED : alignment,
    keepNext: heading,
    indent: {
      ...(firstLine ? { firstLine } : {}),
      ...(left ? { left } : {}),
      ...(right ? { right } : {}),
    },
    spacing: {
      before: before || 0,
      after: after || 0,
      ...(lineRatio ? { line: Math.round(lineRatio * 240) } : {}),
    },
  }));
}

// ---------- Timbrado: cabecalho e rodape ----------

const LOGO_PRIMEIRA_PAGINA = 'https://media.base44.com/images/public/6a5a44d24aa52c9fbdd61b1a/4f1847ac3_image.png';
const LOGO_PAGINAS_INTERNAS = 'https://media.base44.com/images/public/6a5a44d24aa52c9fbdd61b1a/fec36cb66_image.png';

async function carregarImagemBytes(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Falha ao carregar timbrado: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function buildHeader(logoBytes, width, height, alignment = AlignmentType.CENTER) {
  return new Header({
    children: [
      new Paragraph({
        alignment,
        children: logoBytes ? [new ImageRun({ data: logoBytes, transformation: { width, height }, type: 'png' })] : [new TextRun({ text: TIMBRADO.escritorio, bold: true, font: 'Arial', size: 20 })],
      }),
      new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 4 } } }),
    ],
  });
}

function buildFooter() {
  return new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: '888888', space: 4 } },
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `${TIMBRADO.rodape.email}  |  ${TIMBRADO.rodape.oab}`, font: 'Arial', size: 16, color: '555555' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Página ', font: 'Arial', size: 14, color: '888888' }),
          new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 14, color: '888888' }),
          new TextRun({ text: ' de ', font: 'Arial', size: 14, color: '888888' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 14, color: '888888' }),
        ],
      }),
    ],
  });
}

// ---------- Validação e exportação principal ----------

async function validarDocx(blob) {
  if (!(blob instanceof Blob) || blob.size < 1000) throw new Error('O arquivo DOCX gerado está vazio ou incompleto.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const zipValido = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!zipValido) throw new Error('O arquivo gerado não possui uma estrutura DOCX válida.');
  const conteudoBinario = new TextDecoder('latin1').decode(bytes);
  if (!conteudoBinario.includes('[Content_Types].xml') || !conteudoBinario.includes('word/document.xml')) {
    throw new Error('O pacote DOCX não contém os componentes obrigatórios do documento.');
  }
  const possuiDiretorioCentral = conteudoBinario.includes('PK\u0001\u0002') && conteudoBinario.includes('PK\u0005\u0006');
  if (!possuiDiretorioCentral) throw new Error('O pacote DOCX foi criado de forma incompleta.');
  return { valido: true, tamanho_bytes: blob.size, estrutura: 'DOCX/ZIP íntegra' };
}

export async function exportToDocx(html, variables, title) {
  let processed = html || '';

  // Remove cercas de código markdown e tags de envelope que a IA possa ter incluído
  processed = processed.replace(/```[a-z]*\n?/gi, '');
  processed = processed.replace(/<\/?(?:html|head|body|!doctype)[^>]*>/gi, '').trim();
  processed = removeTextLetterhead(processed);

  if (variables) {
    // 1) Resolve blocos condicionais primeiro, usando as entradas booleanas como flags
    const flags = {};
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === 'boolean') flags[key] = value;
    }
    processed = applyConditionals(processed, flags);

    // 2) Substituição simples {{TOKEN}} apenas para valores de texto
    Object.entries(variables).forEach(([key, value]) => {
      if (typeof value === 'boolean') return; // já consumido pelos condicionais acima
      processed = processed.split(`{{${key}}}`).join(value || '');
    });
  }

  const renderedRoot = document.createElement('div');
  renderedRoot.className = 'doc-preview';
  renderedRoot.setAttribute('aria-hidden', 'true');
  renderedRoot.style.cssText = 'position:fixed;left:-100000px;top:0;width:794px;visibility:hidden;pointer-events:none;';
  renderedRoot.innerHTML = processed;
  document.body.appendChild(renderedRoot);

  const children = [];
  const state = { pageCount: 0 };
  try {
    for (const block of renderedRoot.children) processBlock(block, children, state);
  } finally {
    renderedRoot.remove();
  }
  if (!children.length) throw new Error('O documento não possui conteúdo exportável.');

  const logos = await Promise.allSettled([
    carregarImagemBytes(LOGO_PRIMEIRA_PAGINA),
    carregarImagemBytes(LOGO_PAGINAS_INTERNAS),
  ]);
  const logoPrimeiraPagina = logos[0].status === 'fulfilled' ? logos[0].value : null;
  const logoPaginasInternas = logos[1].status === 'fulfilled' ? logos[1].value : null;
  logos.forEach((result, index) => {
    if (result.status === 'rejected') sessionTrace({
      level: 'warn', category: 'Exportação', status: 'AVISO',
      title: `Logomarca ${index + 1} indisponível — usando cabeçalho textual`,
      details: { mensagem: result.reason?.message || String(result.reason) },
    });
  });
  const firstHeader = buildHeader(logoPrimeiraPagina, 220, 44);
  const defaultHeader = buildHeader(logoPaginasInternas, 100, 86, AlignmentType.RIGHT);
  const footer = buildFooter();

  const docx = new Document({
    numbering: {
      config: [{
        reference: 'doc-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    sections: [{
      properties: {
        titlePage: true,
        page: {
          margin: {
            top: 2438,
            right: 1701,
            bottom: 1276,
            left: 1701,
            header: 708,
            footer: 708,
          },
        },
      },
      headers: { first: firstHeader, default: defaultHeader },
      footers: { first: footer, default: footer },
      children,
    }],
  });

  const blob = await Packer.toBlob(docx);
  const validacao = await validarDocx(blob);
  sessionTrace({
    level: 'info', category: 'Exportação', status: 'VALIDADO',
    title: 'DOCX criado e validado antes do download', details: validacao,
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(title || 'documento').replace(/[\\/:*?"<>|]/g, '-')}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return validacao;
}