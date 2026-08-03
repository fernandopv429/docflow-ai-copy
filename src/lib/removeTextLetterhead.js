// Remove o timbrado/header textual que a IA possa reproduzir do modelo.
// O timbrado do escritório (logo + rodapé) é aplicado por CSS na exportação
// (ver .legal-document-review section.docx::before no index.css). Quando a IA
// copia o cabeçalho textual do modelo, esta função o remove para evitar
// duplicação na peça final.

// Padrões de timbrado textual que a IA costuma reproduzir do modelo.
const LETTERHEAD_PATTERNS = [
  /^\s*FAV\s+Advogados\s*$/im,
  /^\s*Fernando\s+Andrade\s+Vieira\s*$/im,
  /^\s*OAB\/SP\s*n[ºo]?\s*320\.?825\s*$/im,
  /^\s*trabalhista@favadvogados\.com\.br\s*$/im,
  /^\s*juridico@favadvogados\.com\.br\s*$/im,
];

// Remove linhas/parágrafos de cabeçalho duplicados do timbrado do escritório.
export function removeTextLetterhead(texto) {
  if (!texto) return texto;
  let t = String(texto);
  for (const re of LETTERHEAD_PATTERNS) {
    t = t.replace(re, '');
  }
  // Remove <p> que ficaram vazios após a limpeza do timbrado
  t = t.replace(/<p>\s*<\/p>/gi, '');
  // Compacta quebras iniciais excessivas
  t = t.replace(/^\s+/, '');
  return t;
}