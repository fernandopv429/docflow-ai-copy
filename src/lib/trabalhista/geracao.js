import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';
import mammoth from 'mammoth';
import { sanitizarTextoEntrevista } from './pdfSanitizer';
import { extrairTextoPdfs } from './pdfTexto';
import { extrairCasoDeTexto } from './parserEntrevista';
import { extrairDeterministico } from './extracaoDeterministica';
import { calcularVerbasCaso } from './mathUtils';
import { montarDadosTemplate } from './dadosTemplate';
import { redigirTesesIA } from './redacaoTeses';
import { listarModelosAtivos, rankearModelos } from './matching';

// Extrai texto puro de arquivos .docx anexados como entrevista.
// A IA NÃO lê .docx por visão (só PDF/imagem) — sem isto, os dados de um
// DOCX anexado nunca chegam ao parser e os colchetes ficam vazios.
async function extrairTextoDocxs(urls) {
  const urlsDocx = (urls || []).filter((u) => /\.docx(\?[^/]*)?$/i.test(String(u)));
  if (!urlsDocx.length) return '';
  let texto = '';
  for (const u of urlsDocx) {
    try {
      const resp = await fetch(u);
      if (!resp.ok) continue;
      const arrayBuffer = await resp.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer });
      if (value && value.trim()) texto += `\n\n${value.trim()}`;
    } catch { /* ignora DOCX ilegível */ }
  }
  return texto.trim();
}
import {
  carregarConfigIntegracoes,
  extrairCnpjs,
  extrairCeps,
  enriquecerCnpjs,
  enriquecerCeps,
  enriquecerDatajud,
  montarTermosDatajud,
  enriquecerCct,
} from './consultas';

// ============================================================
// Motor determinístico: reúne consultas oficiais + extração
// estruturada + cálculos e devolve o objeto de DADOS que preenche
// o template (.docx) e o preview. A IA NÃO gera documento —
// apenas extrai dados e os poucos trechos livres do caso (parser).
// ============================================================
export async function gerarDadosPeca({ texto, fileUrls, attrs, onTool, redigirIA = false } = {}) {
  const notify = (msg) => {
    try {
      onTool?.(msg);
    } catch (e) {
      /* ignora */
    }
  };
  const config = await carregarConfigIntegracoes();
  const urls = [...(fileUrls || [])];
  // DOCX/PDF-texto → extraídos por código (sem IA); PDF escaneado/imagem → visão da IA
  const textoDocx = await extrairTextoDocxs(urls).catch(() => '');
  const { texto: textoPdf, pdfsComTexto } = await extrairTextoPdfs(urls).catch(() => ({ texto: '', pdfsComTexto: new Set() }));
  if (pdfsComTexto.size) notify(`Texto extraído de ${pdfsComTexto.size} PDF(s) sem IA (campos estruturados)...`);
  const urlsDocx = new Set((fileUrls || []).filter((u) => /\.docx(\?[^/]*)?$/i.test(String(u))));
  // Visão da IA só para PDFs SEM texto (escaneados/manuscritos) e imagens
  const urlsVisao = urls.filter((u) => !urlsDocx.has(u) && !pdfsComTexto.has(u));
  // Sanitiza texto da entrevista (remove rodapés ZapSign, hashes, IPs etc.)
  const textoParaExtracao = sanitizarTextoEntrevista([texto || '', textoDocx, textoPdf].filter(Boolean).join('\n\n'));
  const cnpjs = config.cnpj_ativo ? [...extrairCnpjs(textoParaExtracao), ...((attrs && attrs.cnpjs) || [])] : [];
  const ceps = config.cep_ativo ? [...extrairCeps(textoParaExtracao), ...((attrs && attrs.ceps) || [])] : [];
  const cnpjsUnicos = [...new Set(cnpjs.map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 14))];
  const cepsUnicos = [...new Set(ceps.map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 8))];
  if (cnpjsUnicos.length) notify(`Consultando ${cnpjsUnicos.length} CNPJ(s) na Receita Federal (BrasilAPI)...`);
  if (cepsUnicos.length) notify(`Consultando ${cepsUnicos.length} CEP(s) no ViaCEP...`);
  if (config.datajud_ativo) {
    const termos = montarTermosDatajud(attrs);
    if (termos.length) notify(`Consultando DataJud/CNJ (${config.datajud_tribunal || 'trt2'}): ${termos.join(', ')}...`);
  }
  const temMaterial = Boolean((textoParaExtracao && textoParaExtracao.trim()) || urlsVisao.length);
  if (temMaterial) notify('Extraindo dados do caso e calculando verbas (determinístico)...');
  const [dadosReceita, dadosCep, dadosDatajud, extracao] = await Promise.all([
    enriquecerCnpjs(cnpjs),
    enriquecerCeps(ceps),
    enriquecerDatajud(attrs, config),
    temMaterial
      ? withRuntimeCache('extracao-caso', runtimeCacheKey({ v: 4, texto: textoParaExtracao || '', fileUrls: urlsVisao }), () => extrairCasoDeTexto(textoParaExtracao || '', urlsVisao), {
          onHit: () => notify('Reutilizando análise estruturada da entrevista em cache...'),
        }).catch(() => ({ caso: {}, alertas: [{ severidade: 'BLOQUEANTE', descricao: 'Falha na extração estruturada.' }] }))
      : Promise.resolve({ caso: {}, alertas: [] }),
  ]);
  const caso = extracao?.caso || {};
  const alertasExtracao = extracao?.alertas || [];

  // FALLBACK determinístico (regex): quando a IA devolve o caso vazio ou com
  // lacunas, extrai os campos básicos diretamente do texto da entrevista.
  // A IA continua prioritária — o regex só preenche o que estiver faltando.
  const casoDet = temMaterial ? extrairDeterministico(textoParaExtracao) : {};
  const camposDet = Object.keys(casoDet);
  let preenchidosDet = 0;
  for (const k of camposDet) {
    const v = casoDet[k];
    if (v === null || v === undefined || v === '' ) continue;
    const atual = caso[k];
    const vazioAtual = atual === undefined || atual === null || atual === '' || (Array.isArray(atual) && !atual.length);
    if (vazioAtual) {
      caso[k] = v;
      preenchidosDet += 1;
    }
  }
  if (preenchidosDet > 0 && Object.keys(caso).length <= 2) {
    notify(`IA não extraiu dados estruturados — preenchido por extração determinística (${preenchidosDet} campos).`);
  }
  // Corrige série: se a IA confundiu série com o número da CTPS (mesmo valor),
  // usa a série extraída por regex — evita [SÉRIE] na minuta final.
  if (caso.recl_ctps && caso.recl_serie && caso.recl_serie === caso.recl_ctps && casoDet.recl_serie) {
    caso.recl_serie = casoDet.recl_serie;
  }

  // Saneamento pós-extração: corrige valores claramente errados da IA e
  // impede que texto bruto da entrevista vaze em campos estruturados do
  // template (ex.: "FUNÇÃO: AUXILIAR..." dentro de jornada_horario).
  const ESTADOS_CIVIS = /^(solteir[oa]|casad[oa]?|divorciad[oa]|separad[oa]|vi[úu]v[oa]?|un[ií]ão\s+est[áa]vel)$/i;
  if (caso.funcao && ESTADOS_CIVIS.test(caso.funcao.trim())) {
    caso.funcao = casoDet.funcao || '';
  }
  const MARC_ENTREVISTA = /\b(?:FUN[ÇC][ÃA]O|DANO\s+MORAL|DIREITOS\s+LESADOS|JORNADA|SAL[ÁA]RIO|ADMISS[ÃA]O|RESCIS[ÃA]O|CEP|CNPJ|ENDERE[ÇC]O|ESTADO\s+CIVIL|TEMPO\s+LABORADO|DESvio|AC[ÚU]MULO|FOLGAS|HORAS\s+EXTRAS|GRATIFICA[ÇC][ÃA]O)\s*[:/]/i;
  for (const campo of ['jornada_horario', 'desvio_atividades', 'acumulo_atividades', 'local_prestacao', 'recl_endereco', 'funcao', 'escala', 'prorrogacao_jornada', 'intervalo_usufruido']) {
    if (caso[campo] && MARC_ENTREVISTA.test(String(caso[campo]))) {
      const det = casoDet[campo];
      caso[campo] = (det && !MARC_ENTREVISTA.test(String(det))) ? det : '';
    }
  }
  // Dano fatos: em vez de descartar, remove o rótulo da entrevista e preserva
  // o conteúdo real (ex.: "/ DIREITOS LESADOS: Desconto indevido de 6%..." →
  // "Desconto indevido de 6%..."). Se sobrar texto útil, mantém.
  if (caso.dano_fatos && MARC_ENTREVISTA.test(String(caso.dano_fatos))) {
    const limpo = String(caso.dano_fatos)
      .replace(/^(?:\/\s*)?(?:DIREITOS\s+LESADOS|DANO\s+MORAL)\s*[:/]\s*/i, '')
      .trim();
    caso.dano_fatos = limpo.length >= 20 ? limpo : '';
  }

  // Merge dos atributos já extraídos no chat (conversarEntrevista) como fallback.
  // Garante que função, CNPJ, CEP, comarca e local de prestação cheguem ao template
  // mesmo quando o parser estruturado não os extraiu (ex.: PDF não lido pela IA).
  const attrsObj = attrs || {};
  if (!caso.funcao && attrsObj.funcao && !ESTADOS_CIVIS.test(attrsObj.funcao.trim())) caso.funcao = attrsObj.funcao;
  if (!caso.tipo_dispensa && attrsObj.tipo_dispensa) caso.tipo_dispensa = attrsObj.tipo_dispensa;
  if (!caso.comarca_uf && attrsObj.comarca_uf) caso.comarca_uf = attrsObj.comarca_uf;
  if (!caso.local_prestacao && attrsObj.local_prestacao) caso.local_prestacao = attrsObj.local_prestacao;
  // Salário e maior remuneração: crítico — sem salário, TODOS os cálculos
  // rescisórios ficam zerados. Aceita do chat (attrs) quando a entrevista
  // não mencionou explicitamente.
  if (!caso.salario && attrsObj.salario) caso.salario = Number(attrsObj.salario) || undefined;
  if (!caso.maior_remuneracao && attrsObj.maior_remuneracao) caso.maior_remuneracao = Number(attrsObj.maior_remuneracao) || undefined;
  if (!caso.salario && attrsObj.salario_texto) {
    const m = /R\$\s*([\d.,]+)/i.exec(String(attrsObj.salario_texto));
    if (m) {
      const v = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
      if (Number.isFinite(v) && v > 0) caso.salario = v;
    }
  }
  const attrsCnpjs = (attrsObj.cnpjs || []).map((c) => String(c).replace(/\D/g, '')).filter((d) => d.length === 14);
  if (!caso.recl1_cnpj && attrsCnpjs[0]) caso.recl1_cnpj = attrsCnpjs[0];
  if (!caso.recl2_cnpj && attrsCnpjs[1]) caso.recl2_cnpj = attrsCnpjs[1];
  if (alertasExtracao.length) {
    const bloqueantes = alertasExtracao.filter((a) => a.severidade === 'BLOQUEANTE');
    const atencoes = alertasExtracao.filter((a) => a.severidade === 'ATENCAO');
    if (bloqueantes.length) notify(`⚠ ${bloqueantes.length} alerta(s) bloqueante(s) na extração.`);
    if (atencoes.length) notify(`⚠ ${atencoes.length} inconsistência(s) validadas na extração (teses sem apoio foram desativadas).`);
  }

  // 2ª passada: CNPJs/CEPs que o parser extraiu do PDF (caso.recl*_cnpj /
  // endereços com CEP) mas não estavam no texto digitado nem nos attrs da IA.
  // Garante que a Receita/ViaCEP sejam consultados mesmo quando os dados só
  // existem dentro do documento anexado.
  let dadosReceitaFinal = dadosReceita;
  let dadosCepFinal = dadosCep;
  if (config.cnpj_ativo) {
    const cnpjsCaso = [caso?.recl1_cnpj, caso?.recl2_cnpj]
      .filter(Boolean)
      .map((c) => (c || '').replace(/\D/g, ''))
      .filter((d) => d.length === 14 && !cnpjsUnicos.includes(d));
    const unicosCaso = [...new Set(cnpjsCaso)];
    if (unicosCaso.length) {
      notify(`Consultando ${unicosCaso.length} CNPJ(s) extraído(s) do documento na Receita...`);
      dadosReceitaFinal = [...dadosReceita, ...(await enriquecerCnpjs(unicosCaso))];
    }
  }
  if (config.cep_ativo) {
    const cepsCaso = extrairCeps(
      [caso?.recl_endereco, caso?.local_prestacao, caso?.recl1_logradouro].filter(Boolean).join(' ')
    ).filter((d) => d.length === 8 && !cepsUnicos.includes(d));
    const unicosCasoCep = [...new Set(cepsCaso)];
    if (unicosCasoCep.length) {
      notify(`Consultando ${unicosCasoCep.length} CEP(s) extraído(s) do documento no ViaCEP...`);
      dadosCepFinal = [...dadosCep, ...(await enriquecerCeps(unicosCasoCep))];
    }
  }

  // Convenção coletiva (CCT) vigente na data do fato — cláusulas + metadados.
  let dadosCct = null;
  if (config.cct_ativo) {
    notify('Consultando a CCT vigente (categoria/vigência)...');
    dadosCct = await enriquecerCct(caso, attrs, config).catch(() => null);
    if (dadosCct?.meta) {
      if (!caso.cct_ano && dadosCct.meta.ano_base) caso.cct_ano = String(dadosCct.meta.ano_base);
      if (!caso.sindicato && dadosCct.meta.sindicato_laboral) caso.sindicato = dadosCct.meta.sindicato_laboral;
      if (dadosCct.meta.titulo) notify(`CCT aplicável: ${dadosCct.meta.titulo}`);
    }
    // Enriquecer automaticamente com valores da CCT quando não informados na entrevista
    if (dadosCct?.clausulas?.length) {
      // Extrai valor de VT/condução das cláusulas CCT se não informado
      if (!caso.val_conducao) {
        const clausulaVt = dadosCct.clausulas.find((c) =>
          /vale.transporte|condu[çc][ãa]o/i.test(c.ementa || c.texto || '')
        );
        if (clausulaVt) {
          const matchValor = (clausulaVt.ementa || clausulaVt.texto || '').match(/R\$\s*([\d.,]+)/i);
          if (matchValor) {
            const v = parseFloat(matchValor[1].replace(/\./g, '').replace(',', '.'));
            if (v > 0 && v < 30) { caso.val_conducao = v; notify(`Valor de condução obtido da CCT: R$ ${v}`); }
          }
        }
      }
      // Extrai valor de auxílio-alimentação das cláusulas CCT se não informado
      if (!caso.valor_aux_alimentacao) {
        const clausulaAlim = dadosCct.clausulas.find((c) =>
          /alimenta[çc][ãa]o|refei[çc][ãa]o/i.test(c.ementa || c.texto || c.clausula_titulo || '')
        );
        if (clausulaAlim) {
          const matchValor = (clausulaAlim.ementa || clausulaAlim.texto || clausulaAlim.conteudo || '').match(/R\$\s*([\d.,]+)/i);
          if (matchValor) {
            const v = parseFloat(matchValor[1].replace(/\./g, '').replace(',', '.'));
            if (v > 0 && v < 100) { caso.valor_aux_alimentacao = v; notify(`Valor de auxílio-alimentação obtido da CCT: R$ ${v}`); }
          }
        }
      }
      // Extrai a cláusula da multa convencional (penalidade por descumprimento) se não informada
      if (!caso.cct_clausula_multa) {
        const clausulaMulta = dadosCct.clausulas.find((c) =>
          /\bmulta\b|penalidade|descumprimento/i.test(c.ementa || c.texto || c.clausula_titulo || c.conteudo || '')
        );
        if (clausulaMulta?.clausula_ref) {
          caso.cct_clausula_multa = clausulaMulta.clausula_ref;
          notify(`Cláusula da multa convencional obtida da CCT: ${clausulaMulta.clausula_ref}`);
        }
      }
    }
  }

  // Vigilância com folgas trabalhadas (pagas informalmente via PIX/dinheiro):
  // VT e auxílio-alimentação das folgas são devidos pela CCT e não foram
  // pagos nesses dias. Auto-trigger determinístico — evita a omissão dos
  // pedidos de VT/VA nas folgas (erro recorrente em auditorias internas).
  const ehVig = /vigilante|vigil/i.test(caso.funcao || '');
  if (ehVig && caso.tem_ft) {
    caso.tem_vale_transporte = true;
    caso.tem_auxilio_alimentacao = true;
    if (!caso.valor_aux_alimentacao) caso.valor_aux_alimentacao = 39; // padrão SINDEEPRES
  }

  // Cálculo 100% determinístico (a IA não faz aritmética).
  const calculos = calcularVerbasCaso(caso || {});
  if (!caso.salario) notify('⚠ Salário não encontrado na entrevista — cálculos rescisórios ficarão zerados. Informe o salário para gerar os valores.');
  if (caso.data_admissao && caso.data_rescisao) {
    notify(`Contrato: ${caso.data_admissao} a ${caso.data_rescisao} (${Math.round((new Date(caso.data_rescisao) - new Date(caso.data_admissao)) / 86400000 / 30.44)} meses) — função: ${caso.funcao || 'não informada'}.`);
  }

  // Referências mais semelhantes (matching determinístico) — top 3 com
  // pontuação > 0. O "diferencial" de cada uma orienta a IA redatora nos
  // capítulos de mérito, sem inflar o prompt (orçamento dividido entre elas).
  let modeloSemelhante = null;
  let modelosSemelhantes = [];
  let referencias = [];
  try {
    const modelos = await listarModelosAtivos();
    const ranking = rankearModelos(modelos, attrs || {}).filter((r) => r.score > 0).slice(0, 3);
    modelosSemelhantes = ranking.map((r) => r.modelo);
    modeloSemelhante = modelosSemelhantes[0] || null;
    if (modelosSemelhantes.length) {
      const titulos = modelosSemelhantes.map((m) => m.titulo).filter(Boolean).join(' • ');
      if (titulos) notify(`Referências mais semelhantes: ${titulos}`);
      const orcamento = Math.floor(4000 / modelosSemelhantes.length);
      referencias = modelosSemelhantes.map((m) => ({
        titulo: m.titulo || '',
        diferencial: (m.diferencial || m.conteudo || m.resumo || '').slice(0, orcamento),
      }));
    }
  } catch (e) {
    /* segue sem referência */
  }

  // Fonte única de dados para preview e exportação (.docx).
  const dados = montarDadosTemplate({ caso, calculos, attrs, dadosReceita: dadosReceitaFinal, dadosCep: dadosCepFinal });

  // Redação por especialistas de IA (opcional). O núcleo determinístico acima
  // NÃO é afetado: os blocos {{BLOCO_*}} argumentativos são preenchidos por IA,
  // enquanto qualificação, valores e fecho seguem determinísticos.
  if (redigirIA) {
    try {
      const { blocos, especialistasUsados } = await redigirTesesIA({ caso, calculos, dadosCct, dados, referencias, onTool });
      Object.assign(dados, blocos);
      // O template usa {{DANO_MORAL_FATO_ESPECIFICO}} para a narrativa concreta
      // do dano moral (após a fundamentação constitucional fixa). Quando a IA
      // redige o bloco, ele substitui o dano_fatos bruto do parser (que pode vir
      // fragmentado, ex.: "direitos lesados.") por um parágrafo rico e coerente.
      if (blocos.BLOCO_DANO_MORAL) dados.DANO_MORAL_FATO_ESPECIFICO = blocos.BLOCO_DANO_MORAL;
      if (especialistasUsados?.length) notify(`Capítulos redigidos por IA: ${especialistasUsados.join(', ')}.`);
    } catch (e) {
      notify(`Falha na redação por IA (a peça segue com o texto-padrão do template): ${e.message}`);
    }
  }

  return {
    dados,
    dadosReceita: dadosReceitaFinal,
    dadosCep: dadosCepFinal,
    dadosDatajud,
    dadosCct,
    calculos,
    caso,
    alertasExtracao,
    modeloSemelhante: modeloSemelhante ? { titulo: modeloSemelhante.titulo } : null,
    modelosSemelhantes: modelosSemelhantes.map((m) => ({ titulo: m.titulo })),
  };
}