import PizZip from 'pizzip';

// ============================================================
// Gera uma cópia CORRIGIDA do template .docx oficial do escritório,
// adicionando ao "DOS PEDIDOS" as verbas que o código calcula mas
// o template original não exibia (saldo de salário, multa art. 467,
// multa art. 477 §8º e salários em aberto) — assim o valor da causa
// bate com a soma dos pedidos listados.
//
// Roda 100% no navegador: baixa o .docx, edita o document.xml,
// reempacota com PizZip e dispara o download. Sem upload, sem backend.
// ============================================================

const SALDO =
  '<w:p><w:pPr/><w:r><w:t>{{#sem_justa_causa}}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="PargrafodaLista"/></w:pPr><w:r><w:t>\u2022 saldo de sal\u00e1rio (dias trabalhados no m\u00eas da rescis\u00e3o): {{VALOR_SALDO_SALARIO}};</w:t></w:r></w:p>' +
  '<w:p><w:pPr/><w:r><w:t>{{/sem_justa_causa}}</w:t></w:r></w:p>';

const AVISO =
  '<w:p><w:pPr><w:pStyle w:val="PargrafodaLista"/></w:pPr><w:r><w:t>\u2022 aviso pr\u00e9vio indenizado: {{VALOR_AVISO_PREVIO}};</w:t></w:r></w:p>';

const MULTAS =
  '<w:p><w:pPr/><w:r><w:t>{{#sem_justa_causa}}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="PargrafodaLista"/></w:pPr><w:r><w:t>\u2022 multa do art. 467 da CLT (pagamento intempestivo das verbas rescis\u00f3rias): {{VALOR_MULTA_467}};</w:t></w:r></w:p>' +
  '<w:p><w:pPr/><w:r><w:t>{{/sem_justa_causa}}</w:t></w:r></w:p>' +
  '<w:p><w:pPr/><w:r><w:t>{{#sem_justa_causa}}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="PargrafodaLista"/></w:pPr><w:r><w:t>\u2022 multa do art. 477, \u00a78\u00ba, da CLT (pagamento intempestivo das verbas rescis\u00f3rias): {{VALOR_MULTA_477}};</w:t></w:r></w:p>' +
  '<w:p><w:pPr/><w:r><w:t>{{/sem_justa_causa}}</w:t></w:r></w:p>' +
  '<w:p><w:pPr/><w:r><w:t>{{#salarios_em_aberto}}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="PargrafodaLista"/></w:pPr><w:r><w:t>\u2022 sal\u00e1rios em aberto: {{VALOR_SALARIOS_ABERTO}};</w:t></w:r></w:p>' +
  '<w:p><w:pPr/><w:r><w:t>{{/salarios_em_aberto}}</w:t></w:r></w:p>';

const FGTS =
  '<w:p><w:pPr><w:pStyle w:val="PargrafodaLista"/></w:pPr><w:r><w:t>\u2022 FGTS + multa de 40%: {{VALOR_FGTS}} + {{VALOR_MULTA_40}};</w:t></w:r></w:p>';

export async function baixarTemplateCorrigido(url, nomeArquivo = 'MODELO_PRINCIPAL_template_corrigido.docx') {
  if (!url) throw new Error('URL do template não informada.');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Não foi possível baixar o template (HTTP ${resp.status}).`);
  const ab = await resp.arrayBuffer();
  const zip = new PizZip(ab);
  let xml = zip.file('word/document.xml').asText();
  if (!xml) throw new Error('document.xml não encontrado no .docx.');

  const jaTemSaldo = xml.includes('VALOR_SALDO_SALARIO');
  const jaTem467 = xml.includes('VALOR_MULTA_467');
  const jaTem477 = xml.includes('VALOR_MULTA_477');
  const jaTemSalarios = xml.includes('VALOR_SALARIOS_ABERTO');

  // 1) Saldo de salário entra antes do aviso prévio (rescisórias)
  if (!jaTemSaldo && xml.includes(AVISO)) {
    xml = xml.replace(AVISO, SALDO + AVISO);
  }
  // 2) Multas 467/477 + salários em aberto entram após o FGTS+40%
  if ((!jaTem467 || !jaTem477 || !jaTemSalarios) && xml.includes(FGTS)) {
    xml = xml.replace(FGTS, FGTS + MULTAS);
  }

  zip.file('word/document.xml', xml);
  const blob = zip.generate({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);

  return {
    saldoAdicionado: !jaTemSaldo,
    multa467Adicionada: !jaTem467,
    multa477Adicionada: !jaTem477,
    salariosAbertoAdicionado: !jaTemSalarios,
  };
}