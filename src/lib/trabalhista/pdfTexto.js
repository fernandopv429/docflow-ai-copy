// ============================================================
// Extração de texto de PDFs de entrevista no navegador (pdfjs-dist).
// Espelha extrairTextoDocxs (mammoth): devolve texto puro para o
// parser determinístico (regex) — a IA NÃO precisa reler o PDF por
// visão quando o texto é extraível (formulário digitado).
// ============================================================
// pdfjs-dist é carregado sob demanda (import dinâmico) para não afetar o
// carregamento da página e isolar falhas do worker do fluxo principal.
let pdfjsPronto = null;
async function carregarPdfjs() {
  if (pdfjsPronto) return pdfjsPronto;
  const pdfjsLib = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsPronto = pdfjsLib;
  return pdfjsPronto;
}

const ehPdf = (u) => /\.pdf(\?[^/]*)?$/i.test(String(u));

// Extrai texto de um PDF. Retorna { texto, temTexto }.
async function extrairDeUmPdf(url) {
  const pdfjsLib = await carregarPdfjs();
  const resp = await fetch(url);
  if (!resp.ok) return { texto: '', temTexto: false };
  const arrayBuffer = await resp.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let texto = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Reconstrói linhas respeitando o eixo Y dos itens (pdfjs devolve tokens soltos)
    const itens = content.items || [];
    let linha = '';
    let yAtual = null;
    for (const it of itens) {
      const y = it.transform ? it.transform[5] : null;
      if (yAtual != null && y != null && Math.abs(y - yAtual) > 2) {
        texto += `${linha.trim()}\n`;
        linha = '';
      }
      linha += (it.str || '') + (it.hasEOL ? '\n' : ' ');
      yAtual = y != null ? y : yAtual;
    }
    if (linha.trim()) texto += `${linha.trim()}\n`;
    texto += '\n';
  }
  await doc.destroy();
  const temTexto = texto.replace(/\s/g, '').length > 40; // PDF escaneado ~sem texto
  return { texto: texto.trim(), temTexto };
}

// Extrai texto de todos os PDFs. Retorna { texto, pdfsComTexto }.
// pdfsComTexto: conjunto de URLs que puderam ser lidas como texto
// (podem sair da fila de visão da IA — já foram "vistas" via texto).
export async function extrairTextoPdfs(urls) {
  const urlsPdf = (urls || []).filter(ehPdf);
  if (!urlsPdf.length) return { texto: '', pdfsComTexto: new Set() };
  let texto = '';
  const comTexto = new Set();
  for (const u of urlsPdf) {
    try {
      const { texto: t, temTexto } = await extrairDeUmPdf(u);
      if (temTexto) {
        texto += `\n\n${t}`;
        comTexto.add(u);
      }
    } catch { /* PDF ilegível — fica na fila de visão da IA */ }
  }
  return { texto: texto.trim(), pdfsComTexto: comTexto };
}

export { ehPdf };