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

// ------------------------------------------------------------
// Helpers para abrir tópicos à redação da IA sem quebrar o determinístico:
// inserem parágrafos novos com seção invertida — {{#BLOCO}} usa o texto da IA
// quando presente; {{^BLOCO}} mantém a prosa ORIGINAL do template como fallback.
// Operam por índice de parágrafo (robusto à fragmentação em vários <w:t>).
// ------------------------------------------------------------
function _paras(xml) {
  const out = []; const re = /<w:p\b[\s\S]*?<\/w:p>/g; let m;
  while ((m = re.exec(xml))) out.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}
function _textoPara(raw) {
  return (raw.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || []).map((t) => t.replace(/<[^>]*>/g, '')).join('');
}
function _pPr(raw) { const m = raw.match(/<w:pPr>[\s\S]*?<\/w:pPr>/); return m ? m[0] : ''; }
function _paraTx(conteudo, pPr = '') {
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${conteudo}</w:t></w:r></w:p>`;
}
// Insere, DEPOIS da posição `posDepois` e ANTES da posição `posAntes`, os tags de
// abertura/fechamento do fallback invertido, com o bloco de IA no topo.
// Substitui uma frase no XML permitindo tags XML entre as palavras (preserva o resto).
function _substituirFraseTagTolerant(xml, frase, destino) {
  const partes = frase.split(/\s+/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = partes.join('\\s*(?:<[^>]+>)*\\s*');
  return xml.replace(new RegExp(pattern, 'gi'), destino);
}

function _envolver(xml, posAntes_ini, posDepois_fim, bloco, pPr) {
  const antes = _paraTx(`{{#${bloco}}}{{${bloco}}}{{/${bloco}}}`, pPr) + _paraTx(`{{^${bloco}}}`);
  const fim = _paraTx(`{{/${bloco}}}`);
  let novo = xml.slice(0, posDepois_fim) + fim + xml.slice(posDepois_fim); // fim primeiro (posição maior)
  novo = novo.slice(0, posAntes_ini) + antes + novo.slice(posAntes_ini);
  return novo;
}

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
  // 3) E-mail pessoal do reclamante: substitui o texto fixo "O autor não possui
  // correio eletrônico" por um campo {{RECL_EMAIL}} preenchido pelo parser.
  if (xml.includes('O autor n\u00e3o possui correio eletr\u00f4nico')) {
    xml = xml.replace(
      'O autor n\u00e3o possui correio eletr\u00f4nico',
      '{{#RECL_EMAIL}}O autor possui endere\u00e7o de e-mail pessoal: {{RECL_EMAIL}}{{/RECL_EMAIL}}{{^RECL_EMAIL}}O autor n\u00e3o possui correio eletr\u00f4nico{{/RECL_EMAIL}}'
    );
  }

  // 4) Desvio de função: substitui a narrativa FIXA do template por um
  // marcador {{BLOCO_ENQUADRAMENTO}} preenchido pela IA (capítulo rico e
  // sob medida). Fallback determinístico em dadosTemplate garante texto
  // mesmo se a IA não rodar. Mantém o título "DO DESVIO DE FUNÇÃO" e o
  // wrapper condicional {{#desvio_funcao}}...{{/desvio_funcao}}.
  const NARRATIVA_DESVIO =
    'Embora o reclamante tenha informado habitualmente à reclamada sobre o desvio de função, prática vedada pela Convenção Coletiva de Trabalho da Categoria (cláusula 64ª), uma vez que executava, além das funções de {{RECL_FUNCAO}}, {{DESVIO_ATIVIDADES}}, não recebeu qualquer compensação pecuniária a esse título. Portanto, a reclamada deve ser condenada ao pagamento da multa convencional de 50% por mês laborado, com reflexos nos DSRs, férias acrescidas de 1/3, 13º salários e FGTS + 40%.';
  if (!xml.includes('BLOCO_ENQUADRAMENTO') && xml.includes(NARRATIVA_DESVIO)) {
    xml = xml.replace(NARRATIVA_DESVIO, '{{BLOCO_ENQUADRAMENTO}}');
  }

  // 5) Multas convencionais: substitui a frase fixa de abertura (que deixava
  // o número da cláusula {{CCT_CLAUSULA_MULTA}} em branco quando não extraído)
  // por {{BLOCO_MULTAS_CONVENCIONAIS}} — bloco redigido pela IA (parágrafo
  // rico e coerente) ou pelo fallback determinístico de dadosTemplate. A
  // frase inteira está em uma única <w:t>, então a substituição é literal e
  // segura. A lista de infrações que se segue no template é preservada.
  const FRASE_MULTAS = 'O reclamante requer a aplica\u00e7\u00e3o da multa da cl\u00e1usula {{CCT_CLAUSULA_MULTA}} da CCT \u2013 {{CCT_ANO}} e as anteriores, eis que a reclamada n\u00e3o cumpriu com as obriga\u00e7\u00f5es convencionais, onde passamos a discorrer as infra\u00e7\u00f5es infra:';
  if (!xml.includes('BLOCO_MULTAS_CONVENCIONAIS') && xml.includes(FRASE_MULTAS)) {
    xml = xml.replace(FRASE_MULTAS, '{{BLOCO_MULTAS_CONVENCIONAIS}}');
  }

  // 6) DANO MORAL: o corpo do capítulo é o campo {{DANO_MORAL_FATO_ESPECIFICO}}
  // (parágrafo único, não fragmentado). Troca por bloco de IA com fallback ao
  // próprio campo determinístico.
  if (!xml.includes('BLOCO_DANO_MORAL')) {
    xml = xml.replace(
      '{{DANO_MORAL_FATO_ESPECIFICO}}',
      '{{#BLOCO_DANO_MORAL}}{{BLOCO_DANO_MORAL}}{{/BLOCO_DANO_MORAL}}{{^BLOCO_DANO_MORAL}}{{DANO_MORAL_FATO_ESPECIFICO}}{{/BLOCO_DANO_MORAL}}'
    );
  }

  // 7) ESPINHA DA RESCISÃO: envolve os parágrafos das modalidades (do
  // {{#sem_justa_causa}}“O reclamante foi admitido…” até o {{/coacao_demissao}})
  // com {{^BLOCO_ESPINHA_RESCISAO}} — a IA sobrescreve a tese quando redige.
  if (!xml.includes('BLOCO_ESPINHA_RESCISAO')) {
    const ps = _paras(xml);
    const ini = ps.findIndex((p) => { const t = _textoPara(p.raw); return t.includes('{{#sem_justa_causa}}') && t.includes('O reclamante foi admitido'); });
    const fim = ini < 0 ? -1 : ps.findIndex((p, i) => i >= ini && _textoPara(p.raw).includes('{{/coacao_demissao}}'));
    if (ini >= 0 && fim >= 0) xml = _envolver(xml, ps[ini].start, ps[fim].end, 'BLOCO_ESPINHA_RESCISAO', _pPr(ps[ini].raw));
  }

  // 8) SÚMULA 331: envolve o CONTEÚDO do wrapper {{#tem_tomadora}}…{{/tem_tomadora}}
  // que contém o parágrafo “respondendo subsidiariamente… Súmula 331” (fragmentado
  // em 33 runs — por isso envolvemos por parágrafo, sem tocar no texto interno).
  if (!xml.includes('BLOCO_SUMULA_331')) {
    const ps = _paras(xml);
    const idxSub = ps.findIndex((p) => _textoPara(p.raw).includes('respondendo subsidiariamente'));
    if (idxSub >= 0) {
      let ini = -1; for (let i = idxSub; i >= 0; i--) { if (_textoPara(ps[i].raw).trim() === '{{#tem_tomadora}}') { ini = i; break; } }
      let fim = -1; for (let i = idxSub; i < ps.length; i++) { if (_textoPara(ps[i].raw).trim() === '{{/tem_tomadora}}') { fim = i; break; } }
      if (ini >= 0 && fim >= 0) xml = _envolver(xml, ps[ini].end, ps[fim].start, 'BLOCO_SUMULA_331', _pPr(ps[idxSub].raw));
    }
  }

  // 9) JORNADA (narrativa fática): envolve APENAS os parágrafos da seção "DA
  // JORNADA DE TRABALHO" (do "Para elucidação dos direitos…" até "Cumpre
  // ressaltar…", antes do título "DAS HORAS EXTRAS"). A descaracterização da
  // escala (com ementas reais), art. 71, adicional noturno, 10 minutos,
  // periculosidade e DSR permanecem DETERMINÍSTICOS — não são tocados.
  if (!xml.includes('BLOCO_JORNADA')) {
    const ps = _paras(xml);
    const ini = ps.findIndex((p) => _textoPara(p.raw).includes('Para elucidação dos direitos aqui pleiteados'));
    const fim = ini < 0 ? -1 : ps.findIndex((p, i) => i >= ini && _textoPara(p.raw).includes('Cumpre ressaltar que o obreiro pode ter feito outras escalas'));
    if (ini >= 0 && fim >= 0) xml = _envolver(xml, ps[ini].start, ps[fim].end, 'BLOCO_JORNADA', _pPr(ps[ini].raw));
  }

  // 10) GÊNERO: troca "o autor" fixo do template por "o reclamante" — a flexão
  // de exportação (preencherDocxTemplate.aplicarGenero) já converte "o
  // reclamante" → "a reclamante" quando o reclamante é mulher. "a parte autora"
  // (a parte = feminino gramatical para ambos os gêneros) é preservada. Assim o
  // template novo sai já estruturado para o gênero correto, sem edição manual.
  const FRASES_AUTOR = [
    ['O autor opta pela tramitação', 'O reclamante opta pela tramitação'],
    ['O autor possui endereço de e-mail pessoal', 'O reclamante possui endereço de e-mail pessoal'],
    ['o autor prestou serviços', 'o reclamante prestou serviços'],
    ['patrono do autor', 'patrono do reclamante'],
    ['O autor, nos termos da inclusa declaração', 'O reclamante, nos termos da inclusa declaração'],
  ];
  let autorCorrigido = false;
  for (const [a, b] of FRASES_AUTOR) {
    if (xml.includes(a)) { xml = _substituirFraseTagTolerant(xml, a, b); autorCorrigido = true; }
  }

  // 11) E-MAIL NO PREÂMBULO: garante que a qualificação do reclamante tenha
  // o campo {{RECL_EMAIL}} (e-mail pessoal do cliente). Se o template original
  // não o incluir após o endereço, insere ", com correio eletrônico
  // {{RECL_EMAIL}}" logo após {{RECL_ENDERECO}}. Não duplica se já existir.
  let emailPreambuloAdicionado = false;
  if (xml.includes('{{RECL_ENDERECO}}') && !/{{RECL_EMAIL}}/.test(xml.slice(xml.indexOf('{{RECL_ENDERECO}}'), xml.indexOf('{{RECL_ENDERECO}}') + 300))) {
    xml = xml.replace(/(\{\{RECL_ENDERECO\}\})/, '$1, com correio eletrônico {{RECL_EMAIL}}');
    emailPreambuloAdicionado = true;
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
    autorCorrigido,
    emailPreambuloAdicionado,
  };
}