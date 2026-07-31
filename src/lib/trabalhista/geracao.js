import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';
import mammoth from 'mammoth';
import { sanitizarTextoEntrevista } from './pdfSanitizer';
import { extrairTextoPdfs } from './pdfTexto';
import { extrairCasoDeTexto } from './parserEntrevista';
import { extrairDeterministico } from './extracaoDeterministica';
import { calcularVerbasCaso } from './mathUtils';
import { montarDadosTemplate } from './dadosTemplate';
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
export async function gerarDadosPeca({ texto, fileUrls, attrs, onTool } = {}) {
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

  // Merge dos atributos já extraídos no chat (conversarEntrevista) como fallback.
  // Garante que função, CNPJ, CEP, comarca e local de prestação cheguem ao template
  // mesmo quando o parser estruturado não os extraiu (ex.: PDF não lido pela IA).
  const attrsObj = attrs || {};
  if (!caso.funcao && attrsObj.funcao) caso.funcao = attrsObj.funcao;
  if (!caso.tipo_dispensa && attrsObj.tipo_dispensa) caso.tipo_dispensa = attrsObj.tipo_dispensa;
  if (!caso.comarca_uf && attrsObj.comarca_uf) caso.comarca_uf = attrsObj.comarca_uf;
  if (!caso.local_prestacao && attrsObj.local_prestacao) caso.local_prestacao = attrsObj.local_prestacao;
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

  // Cálculo 100% determinístico (a IA não faz aritmética).
  const calculos = calcularVerbasCaso(caso || {});

  // Referência mais semelhante (matching determinístico) — informativo.
  let modeloSemelhante = null;
  try {
    const modelos = await listarModelosAtivos();
    const ranking = rankearModelos(modelos, attrs || {});
    if (ranking[0] && ranking[0].score > 0) {
      modeloSemelhante = ranking[0].modelo;
      if (modeloSemelhante.titulo) notify(`Referência mais semelhante: ${modeloSemelhante.titulo}`);
    }
  } catch (e) {
    /* segue sem referência */
  }

  // Fonte única de dados para preview e exportação (.docx).
  const dados = montarDadosTemplate({ caso, calculos, attrs, dadosReceita: dadosReceitaFinal, dadosCep: dadosCepFinal });

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
  };
}