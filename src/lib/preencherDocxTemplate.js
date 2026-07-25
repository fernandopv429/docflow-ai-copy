import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// Preenche um TEMPLATE .docx (marcado com {{campos}} e {{#flags}}...{{/flags}})
// usando docxtemplater. Preserva 100% da formatação do .docx original.
// - arrayBuffer: bytes do .docx do template
// - dados: objeto com os valores dos campos e os booleanos dos flags
export function preencherDocxTemplate(arrayBuffer, dados) {
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' }, // usa {{campo}} e {{#flag}}...{{/flag}}
    paragraphLoop: true,
    linebreaks: true, // quebras de linha (\n) viram <w:br/> nos parágrafos
    nullGetter: () => '', // campo ausente = vazio (não quebra a renderização)
  });
  doc.render(dados || {});
  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

// Busca o template hospedado, preenche com os dados e dispara o download do .docx.
export async function exportarDocxTemplate(templateUrl, dados, titulo) {
  const resp = await fetch(templateUrl);
  if (!resp.ok) throw new Error(`Não foi possível carregar o template (HTTP ${resp.status}).`);
  const buf = await resp.arrayBuffer();
  const blob = preencherDocxTemplate(buf, dados);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${titulo || 'peticao'}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
