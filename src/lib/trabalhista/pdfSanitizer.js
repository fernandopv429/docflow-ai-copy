// ============================================================
// Sanitizador de texto extraído de PDFs de entrevista assinada.
// Remove rodapés/logs de assinatura digital (ZapSign, Clicksign,
// Truora) e metadados irrelevantes antes de enviar ao parser da IA.
// ============================================================

export function sanitizarTextoEntrevista(rawText) {
  if (!rawText) return '';

  let t = rawText;

  // 1. Remove página inteira do Relatório de Assinaturas ZapSign/Truora
  t = t.replace(/Relatório de Assinaturas[\s\S]*?zapsign\.com\.br\s*/gi, '');

  // 2. Remove bloco de assinatura digital inline (rodapé de cada página).
  // O pdfjs pode colocar a assinatura NA MESMA LINHA que o último conteúdo da página.
  // Capturamos só a parte da assinatura, da palavra "Assinado" até o fim da linha/timestamp.
  t = t.replace(/\s*Assinado digitalmente via ZapSign[^\n]*?\(UTC[+-]\d+\)[^\n]*/gi, '');
  // Remove rodapé "ZapSign - UUID | Documento assinado..." (aparece no final de cada página)
  t = t.replace(/\s*ZapSign\s*-\s*[a-f0-9-]{36}[^\n]*/gi, '');

  // 3. Remove campos de metadados de autenticação
  t = t.replace(/^Hash do documento original[\s\S]*?\n/gim, '');
  t = t.replace(/^Token:.*\n/gim, '');
  t = t.replace(/^IP:.*\n/gim, '');
  t = t.replace(/^Dispositivo:.*\n/gim, '');
  t = t.replace(/^Localização aproximada:.*\n/gim, '');
  t = t.replace(/^Telefone:.*\n/gim, '');
  t = t.replace(/^Pontos de autenticação:[\s\S]*?\n\n/gim, '');

  // 4. Remove certificação ICP-Brasil
  t = t.replace(/INTEGRIDADE CERTIFICADA[\s\S]*?14\.063\/2020\./gi, '');

  // 5. Remove URLs
  t = t.replace(/https?:\/\/\S+/g, '');

  // 6. Remove linhas com apenas números de hash (SHA256 etc.)
  t = t.replace(/^[a-f0-9]{32,}\s*$/gim, '');

  // 7. Remove linhas com UUID isolado
  t = t.replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\s*$/gim, '');

  // 8. Normaliza quebras de linha e espaços
  t = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');

  return t;
}