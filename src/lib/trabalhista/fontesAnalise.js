function fonteTexto(texto) {
  return texto?.trim()
    ? [{ tipo: 'texto', nome: 'Entrevista fornecida pelo usuário no chat' }]
    : [];
}

function fontesDocumentos(documentos = []) {
  return documentos.map((documento) => ({
    tipo: 'documento',
    nome: documento.nome,
    url: documento.url,
  }));
}

export function fontesEntrevista({ texto, documentos }) {
  return [...fonteTexto(texto), ...fontesDocumentos(documentos)];
}

export function fontesAuditoria({ texto, template, referencia }) {
  const fontes = fonteTexto(texto);
  fontes.push({ tipo: 'minuta', nome: 'Minuta gerada nesta sessão' });
  if (template) fontes.push({ tipo: 'template principal', nome: template.title, url: template.content_url || undefined });
  if (referencia) fontes.push({ tipo: 'modelo de referência', nome: referencia.titulo, url: referencia.arquivo_url || undefined });
  return fontes;
}

export function fontesGeracao({ texto, documentos, template, referencia, dadosReceita, dadosCep, dadosDatajud }) {
  const fontes = [...fonteTexto(texto), ...fontesDocumentos(documentos)];
  if (template) fontes.push({ tipo: 'template principal', nome: template.title, url: template.content_url || undefined });
  if (referencia) fontes.push({ tipo: 'modelo de referência', nome: referencia.titulo, url: referencia.arquivo_url || undefined });
  if (dadosReceita?.length) fontes.push({ tipo: 'fonte externa', nome: 'BrasilAPI — consulta de CNPJ', url: 'https://brasilapi.com.br/docs#tag/CNPJ' });
  if (dadosCep?.length) fontes.push({ tipo: 'fonte externa', nome: 'ViaCEP — consulta de endereço', url: 'https://viacep.com.br/' });
  if (dadosDatajud?.length) fontes.push({ tipo: 'fonte externa', nome: 'DataJud — Conselho Nacional de Justiça', url: 'https://datajud-wiki.cnj.jus.br/' });
  return fontes;
}