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

// Escapa texto para uso em regex
function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Substitui uma frase no XML permitindo tags XML entre as palavras (preserva o resto)
function substituirFraseTagTolerant(xml, frase, destino) {
  const partes = frase.split(/\s+/).map(escaparRegex);
  const pattern = partes.join('\\s*(?:<[^>]+>)*\\s*');
  return xml.replace(new RegExp(pattern, 'gi'), destino);
}

// Correções pós-preenchimento do .docx:
// 1) Duplicação de palavras consecutivas idênticas (artifact do docxtemplater/paragraphLoop)
// 2) Erros recorrentes de redação do template (Súmula 425, grafia de município)
function corrigirTextoFinal(zip) {
  const alvo = 'word/document.xml';
  const file = zip.file(alvo);
  if (!file) return;
  let xml = file.asText();
  // 1) Remove duplicação "palavra palavra" dentro de cada nó de texto <w:t>
  xml = xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (m, open, text, close) => {
    const corrigido = text.replace(/\b([\wÀ-ÿ][\wÀ-ÿ-]*)\s+\1\b/gi, '$1');
    return open + corrigido + close;
  });
  // 2) Correções de redação (tolerante a tags entre palavras)
  xml = substituirFraseTagTolerant(xml, 'Súmula 425 do Tribunal Superior do Trabalho', 'artigo 791-A da CLT');
  xml = substituirFraseTagTolerant(xml, 'Súmula 425 TST', 'artigo 791-A da CLT');
  xml = substituirFraseTagTolerant(xml, 'Itapecerica da Terra', 'Itapecerica da Serra');
  zip.file(alvo, xml);
}

// Mapeamento de marcadores [ENTRE COLCHETES] -> campos de dados (mesma tabela do previewTemplate)
const MARCADORES_COLCHETES = {
  'VARA / CIDADE / REGIÃO': 'VARA_CIDADE_REGIAO',
  'NOME DO RECLAMANTE': 'RECL_NOME',
  'ESTADO CIVIL': 'RECL_ESTADO_CIVIL',
  'FUNÇÃO': 'RECL_FUNCAO',
  'RG': 'RECL_RG',
  'CPF': 'RECL_CPF',
  'PIS': 'RECL_PIS',
  'SÉRIE': 'RECL_SERIE',
  'CTPS': 'RECL_CTPS',
  'DATA DE NASCIMENTO': 'RECL_NASCIMENTO',
  'FILIAÇÃO': 'RECL_FILIACAO',
  'ENDEREÇO DO RECLAMANTE': 'RECL_ENDERECO',
  'RAZÃO SOCIAL 1ª RECLAMADA': 'RECLAMADA1_RAZAO',
  'CNPJ - confirmar': 'RECLAMADA1_CNPJ',
  'ENDEREÇO - confirmar': 'RECLAMADA1_ENDERECO',
  'LOCAL DE PRESTAÇÃO': 'LOCAL_PRESTACAO_ENDERECO',
  'DATA DE ADMISSÃO': 'DATA_ADMISSAO',
  'DATA DE RESCISÃO': 'DATA_RESCISAO',
  'SALÁRIO': 'SALARIO',
  'DESCREVER O FATO CONCRETO DO DANO MORAL': 'DANO_MORAL_FATO_ESPECIFICO',
  'HORÁRIOS': 'JORNADA_HORARIOS',
  'ESCALA': 'ESCALA',
};

// Remove tags XML internas para unir texto fragmentado (ex.: [NOME<b>...</b>] -> [NOME])
function unirTextosFragmentados(xml) {
  // Une texto dentro de colchetes que pode estar quebrado por tags <w:r>/<w:t>
  // Estratégia: remove tags XML dentro de padrões [...] mantendo os colchetes
  return xml.replace(/\[([^\]]*)\]/g, (match) => {
    const texto = match.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return `[${texto}]`;
  });
}

// Substitui marcadores [ENTRE COLCHETES] no XML do docx pelos valores reais.
function substituirColchetesNoXml(xml, dados) {
  // 1) Une fragmentos para evitar que tags XML quebrem o match
  let out = unirTextosFragmentados(xml);
  // 2) Substitui pelo valor
  out = out.replace(/\[([^\]]+)\]/g, (match, conteudo) => {
    const campo = MARCADORES_COLCHETES[conteudo.trim()];
    const v = campo ? dados[campo] : undefined;
    return (v != null && v !== '') ? String(v) : match;
  });
  return out;
}

// Preenche um TEMPLATE .docx (marcado com {{campos}}/{{#flags}} OU [MARCADORES])
// usando docxtemplater + substituição direta de colchetes. Preserva 100% da formatação.
export function preencherDocxTemplate(arrayBuffer, dados) {
  const zip = new PizZip(arrayBuffer);

  // Substituição direta de [MARCADORES] no XML antes do docxtemplater
  const alvoXml = 'word/document.xml';
  const xmlFile = zip.file(alvoXml);
  if (xmlFile) {
    let xml = xmlFile.asText();
    xml = substituirColchetesNoXml(xml, dados);
    zip.file(alvoXml, xml);
  }

  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' }, // mantém suporte a {{campo}} e {{#flag}}...{{/flag}}
    paragraphLoop: true,
    linebreaks: true,
    // NUNCA deixar placeholder vazio: tags {{CAMPO}} sem valor viram um
    // marcador visível [A PREENCHER: TAG] para o advogado localizar e preencher
    // (ex.: capítulo da IA que não veio, campo não extraído da entrevista).
    nullGetter: (part) => {
      const tag = (part && typeof part === 'object' && part.value) ? part.value : (typeof part === 'string' ? part : '');
      return tag ? `[A PREENCHER: ${tag}]` : '[A PREENCHER]';
    },
  });
  doc.render(dados || {});
  const outZip = doc.getZip();
  // Correções pós-preenchimento (erros recorrentes do template e duplicações do docxtemplater)
  corrigirTextoFinal(outZip);
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