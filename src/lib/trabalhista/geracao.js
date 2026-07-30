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
  const temMaterial = Boolean((texto && texto.trim()) || urls.length);
  if (temMaterial) notify('Extraindo dados do caso e calculando verbas (determinístico)...');
  const [dadosReceita, dadosCep, dadosDatajud, caso] = await Promise.all([
    enriquecerCnpjs(cnpjs),
    enriquecerCeps(ceps),
    enriquecerDatajud(attrs, config),
    temMaterial
      ? withRuntimeCache('extracao-caso', runtimeCacheKey({ texto: texto || '', fileUrls: urls }), () => extrairCasoDeTexto(texto || '', urls), {
          onHit: () => notify('Reutilizando análise estruturada da entrevista em cache...'),
        }).catch(() => ({}))
      : Promise.resolve({}),
  ]);

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
          /alimenta[çc][ãa]o|refei[çc][ãa]o/i.test(c.ementa || c.texto || '')
        );
        if (clausulaAlim) {
          const matchValor = (clausulaAlim.ementa || clausulaAlim.texto || '').match(/R\$\s*([\d.,]+)/i);
          if (matchValor) {
            const v = parseFloat(matchValor[1].replace(/\./g, '').replace(',', '.'));
            if (v > 0 && v < 100) { caso.valor_aux_alimentacao = v; notify(`Valor de auxílio-alimentação obtido da CCT: R$ ${v}`); }
          }
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
    modeloSemelhante: modeloSemelhante ? { titulo: modeloSemelhante.titulo } : null,
  };
}