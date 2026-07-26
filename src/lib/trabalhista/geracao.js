import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';
import { extrairCasoDeTexto } from './parserEntrevista';
import { calcularVerbasCaso } from './mathUtils';
import { montarDadosTemplate } from './dadosTemplate';
import { listarModelosAtivos, rankearModelos } from './matching';
import {
  carregarConfigIntegracoes,
  extrairCnpjs,
  extrairCeps,
  enriquecerCnpjs,
  enriquecerCeps,
  enriquecerDatajud,
  montarTermosDatajud,
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
  const cnpjs = config.cnpj_ativo ? [...extrairCnpjs(texto), ...((attrs && attrs.cnpjs) || [])] : [];
  const ceps = config.cep_ativo ? [...extrairCeps(texto), ...((attrs && attrs.ceps) || [])] : [];
  const cnpjsUnicos = [...new Set(cnpjs.map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 14))];
  const cepsUnicos = [...new Set(ceps.map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 8))];
  if (cnpjsUnicos.length) notify(`Consultando ${cnpjsUnicos.length} CNPJ(s) na Receita Federal (BrasilAPI)...`);
  if (cepsUnicos.length) notify(`Consultando ${cepsUnicos.length} CEP(s) no ViaCEP...`);
  if (config.datajud_ativo) {
    const termos = montarTermosDatajud(attrs);
    if (termos.length) notify(`Consultando DataJud/CNJ (${config.datajud_tribunal || 'trt2'}): ${termos.join(', ')}...`);
  }
  const urls = [...(fileUrls || [])];
  if (texto && texto.trim()) notify('Extraindo dados do caso e calculando verbas (determinístico)...');
  const [dadosReceita, dadosCep, dadosDatajud, caso] = await Promise.all([
    enriquecerCnpjs(cnpjs),
    enriquecerCeps(ceps),
    enriquecerDatajud(attrs, config),
    texto && texto.trim()
      ? withRuntimeCache('extracao-caso', runtimeCacheKey({ texto, fileUrls: urls }), () => extrairCasoDeTexto(texto, urls), {
          onHit: () => notify('Reutilizando análise estruturada da entrevista em cache...'),
        }).catch(() => ({}))
      : Promise.resolve({}),
  ]);

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
  const dados = montarDadosTemplate({ caso, calculos, attrs, dadosReceita, dadosCep });

  return {
    dados,
    dadosReceita,
    dadosCep,
    dadosDatajud,
    calculos,
    caso,
    modeloSemelhante: modeloSemelhante ? { titulo: modeloSemelhante.titulo } : null,
  };
}
