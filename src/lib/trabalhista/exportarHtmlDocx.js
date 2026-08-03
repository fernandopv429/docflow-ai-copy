// ============================================================
// Exporta o HTML da petição gerada pela IA (motor IA completa /
// gerarPecaPadrao) para um .docx editável, preservando a estrutura
// (títulos, parágrafos, listas com aninhamento, citações, tabelas,
// negrito/itálico). Construído com o pacote `docx` — sem depender do
// template .docx do motor determinístico.
// ============================================================
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
} from 'docx';

// Transforma o conteúdo inline de um nó em TextRun[], propagando
// negrito/itálico. <br> vira quebra de linha dentro do parágrafo.
function inlineRuns(node, fmt = {}) {
  const runs = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const text = String(child.textContent || '').replace(/\u00a0/g, ' ');
      if (text) runs.push(new TextRun({ text, bold: !!fmt.bold, italics: !!fmt.italic }));
    } else if (child.nodeType === 1) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') runs.push(new TextRun({ text: '', break: 1 }));
      else if (tag === 'strong' || tag === 'b') runs.push(...inlineRuns(child, { ...fmt, bold: true }));
      else if (tag === 'em' || tag === 'i') runs.push(...inlineRuns(child, { ...fmt, italic: true }));
      else runs.push(...inlineRuns(child, fmt));
    }
  });
  return runs;
}

function tableToDocx(table) {
  const rows = Array.from(table.querySelectorAll('tr'));
  const docRows = rows.map((tr) => {
    const cells = Array.from(tr.children).filter((c) => /^(td|th)$/i.test(c.tagName));
    const docCells = cells.map((tc) => new TableCell({
      children: [new Paragraph({ children: inlineRuns(tc) })],
      width: { size: 100 / (cells.length || 1), type: WidthType.PERCENTAGE },
    }));
    return new TableRow({ children: docCells });
  });
  return new Table({ rows: docRows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

// Percorre os filhos de bloco do nó raiz e devolve Paragraphs/Tables.
// listDepth controla o recuo das listas aninhadas.
function blockChildren(node, listDepth = 0) {
  const out = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const t = String(child.textContent || '').trim();
      if (t) out.push(new Paragraph({ children: [new TextRun({ text: t })] }));
      return;
    }
    if (child.nodeType !== 1) return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'p') {
      out.push(new Paragraph({ children: inlineRuns(child), spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED }));
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      const level = tag === 'h1' ? HeadingLevel.HEADING_1 : tag === 'h2' ? HeadingLevel.HEADING_2 : tag === 'h3' ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4;
      out.push(new Paragraph({ heading: level, children: inlineRuns(child, { bold: true }), spacing: { before: 160, after: 80 } }));
    } else if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(child.children).filter((c) => c.tagName.toLowerCase() === 'li');
      items.forEach((li, idx) => {
        const marker = tag === 'ol' ? `${idx + 1}. ` : '• ';
        const inlineNode = document.createElement('span');
        Array.from(li.childNodes).forEach((c) => {
          if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) return;
          inlineNode.appendChild(c.cloneNode(true));
        });
        out.push(new Paragraph({
          children: [new TextRun({ text: marker }), ...inlineRuns(inlineNode)],
          indent: { left: 360 + listDepth * 360, hanging: 200 },
          spacing: { after: 60 },
        }));
        Array.from(li.children).forEach((c) => {
          if (c.tagName === 'UL' || c.tagName === 'OL') out.push(...blockChildren(c, listDepth + 1));
        });
      });
    } else if (tag === 'blockquote') {
      Array.from(child.childNodes).forEach((c) => {
        if (c.nodeType === 1 && c.tagName.toLowerCase() === 'p') {
          out.push(new Paragraph({ children: inlineRuns(c, { italic: true }), indent: { left: 720 }, spacing: { after: 80 } }));
        } else if (c.nodeType === 3 && c.textContent.trim()) {
          out.push(new Paragraph({ children: [new TextRun({ text: c.textContent.trim(), italics: true })], indent: { left: 720 } }));
        } else if (c.nodeType === 1) {
          out.push(new Paragraph({ children: inlineRuns(c, { italic: true }), indent: { left: 720 } }));
        }
      });
    } else if (tag === 'table') {
      out.push(tableToDocx(child));
    } else if (tag === 'div' || tag === 'section' || tag === 'article') {
      out.push(...blockChildren(child, listDepth));
    } else if (tag === 'hr') {
      /* divisores são proibidos pelo prompt — ignora */
    } else {
      out.push(new Paragraph({ children: inlineRuns(child) }));
    }
  });
  return out;
}

export async function exportarHtmlDocx(html, titulo) {
  const parsed = new DOMParser().parseFromString(`<div id="__root">${html || ''}</div>`, 'text/html');
  const root = parsed.getElementById('__root');
  const children = blockChildren(root, 0);
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1701, bottom: 1134, left: 1701, right: 1701 } } },
      children: children.length ? children : [new Paragraph({ children: [new TextRun({ text: '' })] })],
    }],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${titulo || 'peticao'}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}