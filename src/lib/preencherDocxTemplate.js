import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// ============================================================
// Concordância de gênero (quando a reclamante é mulher)
// Passe CURADO e conservador: só troca termos que inequivocamente
// se referem à reclamante. NÃO mexe em "autor" (aparece em citações
// doutrinárias). Melhor-esforço — a revisão humana continua obrigatória.
// ============================================================
const GENERO_FEM = [
  [/\bo reclamante\b/g, 'a reclamante'],
  [/\bdo reclamante\b/g, 'da reclamante'],
  [/\bao reclamante\b/g, 'à reclamante'],
  [/\bpelo reclamante\b/g, 'pela reclamante'],
  [/\bo obreiro\b/g, 'a obreira'],
  [/\bdo obreiro\b/g, 'da obreira'],
  [/\bao obreiro\b/g, 'à obreira'],
  [/\bobreiro\b/g, 'obreira'],
  [/\bportador\b/g, 'portadora'],
  [/\binscrito\b/g, 'inscrita'],
  [/\bnascido\b/g, 'nascida'],
  [/\bfilho de\b/g, 'filha de'],
  [/\bresidente e domiciliado\b/g, 'residente e domiciliada'],
  [/\bdomiciliado\b/g, 'domiciliada'],
  [/\badmitido\b/g, 'admitida'],
  [/\bdispensado\b/g, 'dispensada'],
  [/\bcoagido\b/g, 'coagida'],
  [/\bameaçado\b/g, 'ameaçada'],
  [/\bcompelido\b/g, 'compelida'],
  [/\bsubmetido\b/g, 'submetida'],
  [/\bcontratado\b/g, 'contratada'],
  [/\bprejudicado\b/g, 'prejudicado(a)'],
  [/\bregistrado\b/g, 'registrada'],
];

function aplicarGenero(zip) {
  const alvo = 'word/document.xml';
  const file = zip.file(alvo);
  if (!file) return;
  let xml = file.asText();
  for (const [re, sub] of GENERO_FEM) xml = xml.replace(re, sub);
  zip.file(alvo, xml);
}

// Preenche um TEMPLATE .docx (marcado com {{campos}} e {{#flags}}...{{/flags}})
// usando docxtemplater. Preserva 100% da formatação do .docx original.
export function preencherDocxTemplate(arrayBuffer, dados) {
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' }, // usa {{campo}} e {{#flag}}...{{/flag}}
    paragraphLoop: true,
    linebreaks: true, // quebras de linha (\n) viram <w:br/> nos parágrafos
    nullGetter: () => '', // campo ausente = vazio (não quebra a renderização)
  });
  doc.render(dados || {});
  const outZip = doc.getZip();
  // Concordância de gênero após o preenchimento (só quando reclamante = mulher)
  if ((dados?.RECL_GENERO || '').toUpperCase() === 'F') aplicarGenero(outZip);
  return outZip.generate({
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
