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
  // "tem texto" = o PDF contém conteúdo de entrevista extraível (não apenas
  // metadados/rodapé ZapSign). Quando verdadeiro, o PDF SAI da fila de visão da IA.
  // Quando falso, o texto parcial ainda é incluído no retorno para o fallback regex,
  // mas o PDF permanece na fila da IA de visão.
  const temConteudoEntrevista = /CARGO|TEMPO\s+LABORADO|CNPJ|CPF|IDENTIFICAÇÃO|RECLAMAD|FATOS\s+NARRADOS|ENTREVISTA/i.test(texto);
  const temTexto = texto.replace(/\s/g, '').length > 80 && temConteudoEntrevista;
  return { texto: texto.trim(), temTexto };
}

// Extrai texto de todos os PDFs. Retorna { texto, pdfsComTexto }.
// pdfsComTexto: conjunto de URLs que puderam ser lidas como texto RICO
// (saem da fila de visão da IA — já foram processadas via texto).
// Mesmo PDFs que vão para a IA de visão têm seu texto parcial incluído
// no retorno para o fallback determinístico (regex) poder usar o que houver.
export async function extrairTextoPdfs(urls) {
  const urlsPdf = (urls || []).filter(ehPdf);
  if (!urlsPdf.length) return { texto: '', pdfsComTexto: new Set() };
  let texto = '';
  const comTexto = new Set();
  for (const u of urlsPdf) {
    try {
      const { texto: t, temTexto } = await extrairDeUmPdf(u);
      if (t && t.trim()) texto += `\n\n${t}`;  // inclui sempre que houver qualquer texto
      if (temTexto) comTexto.add(u);            // sai da fila de visão só se tem texto rico
    } catch { /* PDF ilegível — fica na fila de visão da IA */ }
  }
  return { texto: texto.trim(), pdfsComTexto: comTexto };
}

export { ehPdf };