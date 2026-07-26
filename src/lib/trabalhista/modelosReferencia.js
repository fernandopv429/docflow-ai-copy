import { base44 } from '@/api/base44Client';
import mammoth from 'mammoth';
import { TIPO_DISPENSA_LABELS } from './tokens';
import { extrairCasoDeTexto } from './parserEntrevista';
import { calcularVerbasCaso } from './mathUtils';
import { montarDadosTemplate } from './dadosTemplate';
import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';
import { traceAiCall } from '@/lib/sessionTrace';

// ============================================================
// Anonimização (mesma lógica usada no cadastro dos modelos)
// Remove dados pessoais para que a IA nunca reaproveite dados
// de partes de outros processos.
// ============================================================
export function anonimizarTexto(txt) {
  if (!txt) return '';
  let t = txt;
  t = t.replace(/[\w.\-]+@[\w.\-]+\.\w+/g, '[EMAIL]');
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]');
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]');
  t = t.replace(/\bCEP:?\s*\d{5}-?\d{3}\b/gi, 'CEP: [CEP]');
  t = t.replace(/\b\d{5}-\d{3}\b/g, '[CEP]');
  t = t.replace(/(PIS:?\s*)[\d.\-]+/gi, '$1[PIS]');
  t = t.replace(/(S[ée]rie:?\s*)[\d.\-]+/gi, '$1[SERIE]');
  t = t.replace(/(CTPS:?\s*)[\d.\-]+/gi, '$1[CTPS]');
  t = t.replace(/(RG\s*(?:\/CPF\s*)?(?:n[ºo]\.?)?\s*)[\d.\-Xx]+/g, '$1[RG]');
  t = t.replace(/(nascid[oa] em\s*)\d{2}\/\d{2}\/\d{4}/gi, '$1[DATA_NASC]');
  return t;
}

// ============================================================
// Matching determinístico: pontua cada modelo contra os
// atributos extraídos da entrevista.
// ============================================================
const norm = (s) =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function pontuarModelo(modelo, attrs = {}) {
  let score = 0;
  const motivos = [];
  if (attrs.tipo_dispensa && modelo.tipo_dispensa === attrs.tipo_dispensa) {
    score += 5;
    motivos.push('Mesma modalidade de rescisão');
  }
  if (attrs.funcao && modelo.funcao) {
    const a = norm(attrs.funcao);
    const m = norm(modelo.funcao);
    const mesmaFuncao =
      (a && (m.includes(a) || a.includes(m))) ||
      (a.includes('controlador') && m.includes('controlador')) ||
      (a.includes('porteiro') && m.includes('porteiro'));
    if (mesmaFuncao) {
      score += 2;
      motivos.push('Mesma função');
    }
  }
  if (attrs.rito && modelo.rito === attrs.rito) {
    score += 1;
    motivos.push('Mesmo rito');
  }
  if (attrs.tem_tomadora === true && modelo.tem_tomadora === true) {
    score += 2;
    motivos.push('Tem tomadora (Súm. 331 TST)');
  }
  const modeloTeses = (modelo.teses || []).map(norm);
  for (const t of attrs.teses || []) {
    const nt = norm(t);
    if (nt && modeloTeses.some((x) => x.includes(nt) || nt.includes(x))) {
      score += 1;
      motivos.push(`Tese: ${t}`);
    }
  }
  return { score, motivos };
}

export function rankearModelos(modelos, attrs) {
  return (modelos || [])
    .map((modelo) => ({ modelo, ...pontuarModelo(modelo, attrs) }))
    .sort((a, b) => b.score - a.score);
}

export async function listarModelosAtivos() {
  return withRuntimeCache('modelos-ativos', 'lista', async () => {
    const todos = await base44.entities.ModeloReferencia.list('-updated_date', 100);
    return todos.filter((m) => m.ativo !== false);
  }, { ttlMs: 5 * 60 * 1000 });
}

// Distila de uma peça o que é PARTICULAR (diferencial), ignorando o texto padrão comum.
// Usada na importação para guardar só o que distingue cada modelo (escala melhor).
export async function resumirDiferencial(textoDocx) {
  const prompt = `Você recebe o texto de uma petição inicial trabalhista (modelo correto do escritório). A maior parte é texto PADRÃO, comum a quase toda petição (competência, justiça gratuita, juízo 100% digital, honorários, juros, IR, INSS, ofícios, etc.). IGNORE o padrão e extraia APENAS O QUE É PARTICULAR deste tipo de caso: modalidade de rescisão, teses/capítulos distintivos, argumentos e cláusulas específicas, e QUANDO usar. Seja objetivo (bullet points). Isso orientará a IA quando um caso semelhante aparecer.

TEXTO:
"""
${(textoDocx || '').slice(0, 40000)}
"""

Responda em português, apenas o resumo do diferencial.`;
  const request = { prompt, model: 'gemini_3_flash' };
  const r = await traceAiCall('Resumo do diferencial', request, () =>
    base44.integrations.Core.InvokeLLM(request)
  );
  return typeof r === 'string' ? r : String(r || '');
}

// ============================================================
// Conversa (chat) para coletar dados da entrevista de forma
// incremental e decidir quando gerar a minuta.
// ============================================================
const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Resposta conversacional para o usuário, em português' },
    atributos: {
      type: 'object',
      properties: {
        funcao: { type: 'string' },
        tipo_dispensa: {
          type: 'string',
          enum: [
            'sem_justa_causa',
            'rescisao_indireta',
            'nulidade_pedido_demissao',
            'reversao_justa_causa',
            'acordo',
          ],
        },
        rito: { type: 'string', enum: ['ordinario', 'sumarissimo'] },
        tem_tomadora: { type: 'boolean' },
        teses: { type: 'array', items: { type: 'string' } },
        cnpjs: {
          type: 'array',
          items: { type: 'string' },
          description: 'CNPJs das reclamadas mencionados na conversa OU encontrados nos documentos anexados',
        },
        ceps: {
          type: 'array',
          items: { type: 'string' },
          description: 'CEPs mencionados na conversa OU encontrados nos documentos (endereço do reclamante, local de prestação, reclamadas)',
        },
      },
      required: ['cnpjs', 'ceps', 'teses'], 
    },
    pronto_para_gerar: {
      type: 'boolean',
      description: 'true quando o usuário pediu a minuta OU já há fatos essenciais suficientes',
    },
  },
  required: ['reply', 'atributos', 'pronto_para_gerar'],
};

function resumoModelos(modelos) {
  return (modelos || [])
    .map(
      (m) =>
        `- ${m.titulo} [modalidade=${m.tipo_dispensa || '-'}, rito=${m.rito || '-'}, teses: ${(m.teses || []).slice(0, 6).join(', ')}]`
    )
    .join('\n');
}

function formatarTranscript(transcript) {
  return (transcript || [])
    .map((m) => `${m.role === 'user' ? 'ADVOGADO' : 'ASSISTENTE'}: ${m.text}`)
    .join('\n\n');
}

export function buildChatPrompt({ transcript, modelos, attrsAtuais }) {
  return `Você é um assistente jurídico trabalhista que conversa com um advogado para reunir as informações de uma ENTREVISTA e, ao final, gerar uma petição inicial a partir de um modelo de referência.

CONVERSE em português, de forma objetiva e cordial (estilo chat). Seu papel AGORA é entender o caso e coletar o que falta — NÃO redija a petição nesta etapa (o sistema cuida da redação quando você sinalizar).

Peça, quando ainda não informado, os dados NECESSÁRIOS para uma petição completa: qualificação do reclamante (nome, nacionalidade, estado civil, RG, CPF, PIS, CTPS/Série, data de nascimento, filiação, endereço); reclamada(s) com razão social e CNPJ (e a tomadora, se houver); local de prestação dos serviços (define a competência); função e sindicato/CCT aplicável; datas de admissão e rescisão; salário e a maior remuneração na função (para dano moral e cálculos); jornada/escala; modalidade de rescisão; e as verbas/teses pretendidas. Faça poucas perguntas por vez e sinalize claramente o que ainda falta.

Extraia em "atributos" TUDO o que já for possível inferir da conversa. Nunca devolva "atributos" vazio quando o relato contiver função, CNPJ, CEP, tomadora, rito ou teses. Considere como teses fatos como dano moral, intervalo reduzido, folgas trabalhadas e jornada extraordinária. Defina "pronto_para_gerar" como true quando o advogado pedir a minuta OU quando já houver identificação do reclamante, função, reclamada, datas do contrato, salário, jornada e fatos essenciais. Não invente dados.

MODELOS DE REFERÊNCIA DISPONÍVEIS (o sistema escolherá automaticamente o mais aderente aos atributos):
${resumoModelos(modelos)}

ATRIBUTOS JÁ CONFIRMADOS EM ETAPAS ANTERIORES:
${JSON.stringify(attrsAtuais || {})}

CONVERSA ATÉ AGORA:
${formatarTranscript(transcript)}

Responda APENAS com o objeto JSON.`;
}

function inferirAtributosEntrevista(transcript) {
  const userMessages = (transcript || []).filter((m) => m.role === 'user').map((m) => m.text || '');
  const texto = userMessages.join('\n');
  const ultimaMensagem = userMessages.at(-1) || '';
  let pendencias = [];
  const cepsIncompletosComCnpj = [];
  for (const match of texto.matchAll(/\bcep\s*:?\s*([\d.-]+)/gi)) {
    if (match[1].replace(/\D/g, '').length !== 8) {
      const contextoAnterior = texto.slice(Math.max(0, match.index - 500), match.index);
      const cnpjRelacionado = extrairCnpjs(contextoAnterior).at(-1);
      pendencias.push(`CEP "${match[1]}" inválido. Informe o CEP correto com 8 dígitos.`);
      if (cnpjRelacionado) {
        cepsIncompletosComCnpj.push({ cepInformado: match[1], cnpj: cnpjRelacionado });
      }
    }
  }
  for (const match of texto.matchAll(/\bcnpj(?:\/mf)?\s*:?\s*([\d./-]+)/gi)) {
    if (match[1].replace(/\D/g, '').length !== 14) {
      pendencias.push(`CNPJ "${match[1]}" inválido. Informe o CNPJ correto com 14 dígitos.`);
    }
  }
  for (const match of texto.matchAll(/\bcpf(?:\/mf)?(?:\s*n[ºo]?)?\s*[:/]?\s*([\d.-]+)/gi)) {
    if (match[1].replace(/\D/g, '').length !== 11) {
      pendencias.push(`CPF "${match[1]}" inválido. Informe o CPF correto com 11 dígitos.`);
    }
  }
  if (userMessages.length > 1) {
    if (/\bcep\b\D{0,20}\d{5}[.-]?\d{3}\b/i.test(ultimaMensagem)) {
      pendencias = pendencias.filter((item) => !item.startsWith('CEP'));
    }
    if (/\bcnpj\b\D{0,20}\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/i.test(ultimaMensagem)) {
      pendencias = pendencias.filter((item) => !item.startsWith('CNPJ'));
    }
    if (/\bcpf\b\D{0,20}\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/i.test(ultimaMensagem)) {
      pendencias = pendencias.filter((item) => !item.startsWith('CPF'));
    }
  }
  const funcao = texto.match(/\b(vigilante|porteiro|controlador(?:a)? de acesso)\b/i)?.[1];
  const teses = [];
  if (/dano[s]? moral|persegui|ass[eé]dio/i.test(texto)) teses.push('Dano moral');
  if (/intrajornada|intervalo/i.test(texto)) teses.push('Intervalo intrajornada (art. 71 CLT)');
  if (/folga[s]? trabalhada/i.test(texto)) teses.push('Folgas trabalhadas/DSR');

  const atributos = {
    ...(funcao && { funcao }),
    cnpjs: extrairCnpjs(texto),
    ceps: extrairCeps(texto),
    tem_tomadora: /2[ªa]\s*reclamada|tomadora/i.test(texto),
    teses,
  };
  const essenciais = Boolean(
    funcao &&
    atributos.cnpjs.length &&
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(texto) &&
    /admiss[aã]o\s*:?\s*\d{2}\/\d{2}\/\d{4}/i.test(texto) &&
    /(?:demiss[aã]o|rescis[aã]o|dispensa)\s*:?\s*\d{2}\/\d{2}\/\d{4}/i.test(texto) &&
    /sal[aá]rio\s*:?\s*(?:r\$\s*)?[\d.,]+/i.test(texto) &&
    /(?:escala|hor[aá]rio|jornada)\s*:?/i.test(texto)
  );
  return {
    atributos,
    essenciais,
    pendencias: [...new Set(pendencias)],
    cepsIncompletosComCnpj,
  };
}

function compactarTranscript(transcript) {
  const mensagens = (transcript || []).filter((m) =>
    (m.role === 'user' || m.role === 'assistant') && m.text?.trim()
  );
  if (mensagens.length <= 10) return mensagens;

  const recentes = mensagens.slice(-8);
  const fatosAnteriores = mensagens
    .slice(0, -8)
    .filter((m) => m.role === 'user')
    .map((m) => m.text.trim())
    .join('\n\n');

  return fatosAnteriores
    ? [{ role: 'user', text: `INFORMAÇÕES ANTERIORES FORNECIDAS PELO ADVOGADO:\n${fatosAnteriores}` }, ...recentes]
    : recentes;
}

export async function conversarEntrevista({ transcript, fileUrls, modelos, attrsAtuais }) {
  const transcriptCompacto = compactarTranscript(transcript);
  const req = {
    prompt: buildChatPrompt({ transcript: transcriptCompacto, modelos, attrsAtuais }),
    model: 'claude_sonnet_4_6',
    response_json_schema: CHAT_SCHEMA,
  };
  if (fileUrls?.length) req.file_urls = fileUrls;
  const key = runtimeCacheKey({ version: 5, transcript: transcriptCompacto, fileUrls, modelos, attrsAtuais });
  const resposta = await withRuntimeCache('entrevista-ia', key, () =>
    traceAiCall('Análise da entrevista', req, () => base44.integrations.Core.InvokeLLM(req))
  );
  const inferido = inferirAtributosEntrevista(transcript);
  const ia = resposta?.atributos || {};
  const atributos = {
    ...inferido.atributos,
    ...ia,
    cnpjs: [...new Set([...(inferido.atributos.cnpjs || []), ...(ia.cnpjs || [])])],
    ceps: [...new Set([...(inferido.atributos.ceps || []), ...(ia.ceps || [])])],
    teses: [...new Set([...(inferido.atributos.teses || []), ...(ia.teses || [])])],
  };
  const correcoesAutomaticas = [];
  if (inferido.cepsIncompletosComCnpj.length) {
    const dadosOficiais = await enriquecerCnpjs(
      inferido.cepsIncompletosComCnpj.map((item) => item.cnpj)
    );
    for (const item of inferido.cepsIncompletosComCnpj) {
      const cnpjDigits = item.cnpj.replace(/\D/g, '');
      const oficial = dadosOficiais.find((dado) => (dado.cnpj || '').replace(/\D/g, '') === cnpjDigits);
      const cepOficial = (oficial?.cep || '').replace(/\D/g, '');
      if (!oficial?.erro && cepOficial.length === 8) {
        inferido.pendencias = inferido.pendencias.filter(
          (pendencia) => !pendencia.startsWith(`CEP "${item.cepInformado}"`)
        );
        atributos.ceps = [...new Set([...(atributos.ceps || []), cepOficial])];
        correcoesAutomaticas.push(`CEP ${oficial.cep} confirmado pelo CNPJ ${oficial.cnpj}`);
      }
    }
  }

  const pronto = Boolean(resposta?.pronto_para_gerar || inferido.essenciais) && !inferido.pendencias.length;
  let reply = resposta?.reply || 'Dados recebidos e analisados.';
  if (inferido.pendencias.length) {
    reply = `Identifiquei dados que precisam ser corrigidos antes de gerar a minuta:\n\n${inferido.pendencias.map((item) => `• ${item}`).join('\n')}`;
  } else if (correcoesAutomaticas.length) {
    reply = `Completei dados incompletos usando informações oficiais disponíveis:\n\n${correcoesAutomaticas.map((item) => `• ${item}`).join('\n')}\n\n${pronto ? 'Os dados essenciais estão completos e a minuta será gerada.' : reply}`;
  } else if (pronto && /^certo[.!]?$/i.test(reply.trim())) {
    reply = 'Dados essenciais identificados. Vou gerar a minuta com as informações fornecidas.';
  }
  return { ...resposta, reply, atributos, pronto_para_gerar: pronto };
}

// ============================================================
// Consulta de CNPJ na Receita Federal (BrasilAPI) — determinística.
// Usada sempre que houver CNPJ, para preencher a qualificação das
// reclamadas com dados oficiais (sem alucinação da IA).
// ============================================================
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

export function extrairCnpjs(texto) {
  const encontrados = new Set();
  for (const m of (texto || '').matchAll(CNPJ_RE)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length === 14) encontrados.add(d);
  }
  return [...encontrados];
}

function formatarCnpj(digits) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export async function consultarCnpj(cnpj) {
  const digits = (cnpj || '').replace(/\D/g, '');
  if (digits.length !== 14) return { cnpj, erro: 'CNPJ inválido (precisa de 14 dígitos)' };
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
    if (resp.status === 404) return { cnpj: formatarCnpj(digits), erro: 'não encontrado na Receita' };
    if (!resp.ok) return { cnpj: formatarCnpj(digits), erro: `erro HTTP ${resp.status}` };
    const d = await resp.json();
    const cep = (d.cep || '').replace(/\D/g, '');
    const endereco = [
      `${d.descricao_tipo_de_logradouro || ''} ${d.logradouro || ''}`.trim(),
      d.numero,
      d.complemento,
      d.bairro,
      [d.municipio, d.uf].filter(Boolean).join('/'),
    ]
      .filter(Boolean)
      .join(', ');
    return {
      cnpj: formatarCnpj(digits),
      razao_social: d.razao_social || '',
      endereco,
      cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep,
      situacao: d.descricao_situacao_cadastral || '',
    };
  } catch (e) {
    return { cnpj: formatarCnpj(digits), erro: 'falha de rede ao consultar a Receita' };
  }
}

export async function enriquecerCnpjs(cnpjs) {
  const unicos = [
    ...new Set((cnpjs || []).map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 14)),
  ];
  if (!unicos.length) return [];
  const key = [...unicos].sort().join(',');
  return withRuntimeCache('cnpj', key, () => Promise.all(unicos.map(consultarCnpj)), { ttlMs: 60 * 60 * 1000 });
}

function blocoReceita(dados) {
  if (!dados?.length) return '';
  const linhas = dados.map((d) =>
    d.erro
      ? `- CNPJ ${d.cnpj}: ${d.erro} — use o marcador [CNPJ - confirmar].`
      : `- ${d.razao_social} — CNPJ ${d.cnpj}, ${d.endereco}, CEP ${d.cep} (situação cadastral: ${d.situacao}).`
  );
  return `\n\nDADOS OFICIAIS DAS RECLAMADAS (verificados na Receita Federal via BrasilAPI — USE ESTES dados exatos na qualificação das reclamadas, com a razão social e o endereço oficiais):\n${linhas.join('\n')}`;
}

// ============================================================
// Consulta de CEP (ViaCEP, com fallback BrasilAPI) — determinística.
// Completa o endereço do reclamante e do local de prestação (competência).
// ============================================================
const CEP_LABEL_RE = /CEP:?\s*(\d{5}-?\d{3})/gi;
const CEP_DASH_RE = /\b\d{5}-\d{3}\b/g;

export function extrairCeps(texto) {
  const encontrados = new Set();
  const t = texto || '';
  for (const m of t.matchAll(CEP_LABEL_RE)) {
    const d = m[1].replace(/\D/g, '');
    if (d.length === 8) encontrados.add(d);
  }
  for (const m of t.matchAll(CEP_DASH_RE)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length === 8) encontrados.add(d);
  }
  return [...encontrados];
}

export async function consultarCep(cep) {
  const digits = (cep || '').replace(/\D/g, '');
  if (digits.length !== 8) return { cep, erro: 'CEP inválido (precisa de 8 dígitos)' };
  const fmt = `${digits.slice(0, 5)}-${digits.slice(5)}`;
  // 1) ViaCEP (traz município + código IBGE)
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (resp.ok) {
      const d = await resp.json();
      if (!d.erro) {
        return {
          cep: fmt,
          logradouro: d.logradouro || '',
          bairro: d.bairro || '',
          municipio: d.localidade || '',
          uf: d.uf || '',
          ibge: d.ibge || '',
        };
      }
    }
  } catch (e) {
    // segue para o fallback
  }
  // 2) Fallback BrasilAPI
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cep/v1/${digits}`);
    if (resp.ok) {
      const d = await resp.json();
      return {
        cep: fmt,
        logradouro: d.street || '',
        bairro: d.neighborhood || '',
        municipio: d.city || '',
        uf: d.state || '',
        ibge: '',
      };
    }
  } catch (e) {
    // ignora
  }
  return { cep: fmt, erro: 'não encontrado' };
}

export async function enriquecerCeps(ceps) {
  const unicos = [
    ...new Set((ceps || []).map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 8)),
  ];
  if (!unicos.length) return [];
  const key = [...unicos].sort().join(',');
  return withRuntimeCache('cep', key, () => Promise.all(unicos.map(consultarCep)), { ttlMs: 60 * 60 * 1000 });
}

function blocoCeps(dados) {
  if (!dados?.length) return '';
  const linhas = dados.map((d) =>
    d.erro
      ? `- CEP ${d.cep}: ${d.erro} — confirme o endereço.`
      : `- CEP ${d.cep}: ${[d.logradouro, d.bairro, [d.municipio, d.uf].filter(Boolean).join('/')].filter(Boolean).join(', ')}.`
  );
  return `\n\nENDEREÇOS VERIFICADOS POR CEP (ViaCEP — use para completar logradouro/bairro/município/UF na qualificação; o município orienta a Vara do Trabalho e o UF o TRT da competência):\n${linhas.join('\n')}`;
}

// ============================================================
// Configuração das integrações (liga/desliga cada tool). Singleton.
// ============================================================
export const CONFIG_INTEGRACOES_PADRAO = {
  cnpj_ativo: true,
  cep_ativo: true,
  datajud_ativo: false,
  datajud_tribunal: 'trt2',
  datajud_size: 5,
};

export async function carregarConfigIntegracoes() {
  return withRuntimeCache('config-integracoes', 'atual', async () => {
    try {
      const lista = await base44.entities.IntegracaoConfig.list('-updated_date', 1);
      return { ...CONFIG_INTEGRACOES_PADRAO, ...(lista?.[0] || {}) };
    } catch (e) {
      return { ...CONFIG_INTEGRACOES_PADRAO };
    }
  }, { ttlMs: 5 * 60 * 1000 });
}

// ============================================================
// Consulta ao DataJud (CNJ) — jurisprudência/processos por tema.
// Vai por FUNÇÃO DE BACKEND (base44.functions.invoke('datajud')),
// porque o DataJud não libera CORS para o navegador.
// A busca é montada por palavras-chave/contexto da entrevista.
// ============================================================
export function montarTermosDatajud(attrs) {
  const termos = [...((attrs && attrs.teses) || [])];
  if (!termos.length && attrs?.funcao) termos.push(attrs.funcao);
  return [...new Set(termos.map((t) => (t || '').trim()).filter(Boolean))].slice(0, 4);
}

export async function consultarDatajud({ termo, tribunal = 'trt2', size = 5 }) {
  try {
    const resp = await base44.functions.invoke('datajud', { termo, tribunal, size });
    const data = resp?.data ?? resp;
    const hits = data?.hits || data?.processos || [];
    return { termo, hits: Array.isArray(hits) ? hits : [] };
  } catch (e) {
    return { termo, erro: 'indisponível' };
  }
}

export async function enriquecerDatajud(attrs, config) {
  if (!config?.datajud_ativo) return [];
  const termos = montarTermosDatajud(attrs);
  if (!termos.length) return [];
  const key = runtimeCacheKey({ termos, tribunal: config.datajud_tribunal, size: config.datajud_size });
  return withRuntimeCache('datajud', key, () => Promise.all(
    termos.map((termo) =>
      consultarDatajud({
        termo,
        tribunal: config.datajud_tribunal || 'trt2',
        size: config.datajud_size || 5,
      })
    )
  ), { ttlMs: 30 * 60 * 1000 });
}

function blocoDatajud(resultados) {
  const comHits = (resultados || []).filter((r) => r && !r.erro && r.hits?.length);
  if (!comHits.length) return '';
  const linhas = comHits.map((r) => {
    const exemplos = r.hits.slice(0, 3).map((h) => {
      const numero = h.numero || h.numeroProcesso || '?';
      const classe = h.classe || (h.classe && h.classe.nome) || '-';
      const assuntos = (h.assuntos || []).map((a) => (typeof a === 'string' ? a : a.nome)).slice(0, 2);
      return `${numero} — ${classe}${assuntos.length ? ` (${assuntos.join(', ')})` : ''}`;
    });
    return `- Tema "${r.termo}": ${exemplos.join('; ')}`;
  });
  return `\n\nCONTEXTO JURISPRUDENCIAL (DataJud/CNJ — mostra que o tema é recorrente no tribunal; use só como reforço argumentativo, NÃO cite números de processo específicos sem conferência humana):\n${linhas.join('\n')}`;
}

// Motor determinístico: reúne consultas oficiais + extração estruturada +
// cálculos e devolve o objeto de DADOS que preenche o template (.docx) e o
// preview. A IA NÃO gera documento — apenas extrai dados e os poucos trechos
// livres do caso (fatos do dano moral / da rescisão), feito no parser.
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

// Verificação de coerência jurídica da minuta gerada (LLM audita, não reescreve).
const COERENCIA_SCHEMA = {
  type: 'object',
  required: ['status', 'alertas'],
  properties: {
    status: { type: 'string', enum: ['aprovado', 'revisar', 'bloqueado'] },
    alertas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severidade: { type: 'string', enum: ['BLOQUEANTE', 'ATENCAO', 'INFO'] },
          descricao: { type: 'string' },
          sugestao: { type: 'string' },
        },
      },
    },
  },
};

export async function verificarCoerencia({ texto, caso, dados, documentoTexto }) {
  const prompt = `Você é um auditor jurídico trabalhista. Verifique a MINUTA gerada quanto à COERÊNCIA factual e jurídica com o caso. NÃO reescreva a peça — apenas aponte problemas.

Checagens obrigatórias:
- Tese/pedido SEM suporte no relato (ex.: adicional noturno sem jornada noturna; periculosidade/insalubridade sem exposição relatada; horas extras sem alegação de sobrejornada).
- Verba pedida em DUPLICIDADE.
- Marcadores entre colchetes [ ] ainda pendentes (dados que faltam preencher).
- Modalidade de rescisão incompatível com os pedidos.
- Valor da causa acima de R$ 400.000,00.
- Ausência de tópico obrigatório (ex.: responsabilidade subsidiária quando há tomadora).

Classifique cada alerta: BLOQUEANTE (erro grave), ATENCAO (revisar) ou INFO. Defina "status": "bloqueado" se houver BLOQUEANTE; "revisar" se houver ATENCAO; senão "aprovado".

DADOS DO CASO (estruturado): ${JSON.stringify(caso || {})}
DADOS/FLAGS DO TEMPLATE (o que foi ligado na peça): ${JSON.stringify(dados || {})}
RELATO/ENTREVISTA: """${texto || ''}"""
${documentoTexto ? `MINUTA GERADA (texto): """${documentoTexto}"""` : ''}

Responda APENAS com o objeto JSON.`;
  const request = {
    prompt,
    model: 'claude_sonnet_4_6',
    response_json_schema: COERENCIA_SCHEMA,
  };
  return withRuntimeCache('auditoria-coerencia', runtimeCacheKey(prompt), () =>
    traceAiCall('Auditoria de coerência', request, () => base44.integrations.Core.InvokeLLM(request))
  );
}

// ============================================================
// Importação de um .docx real para enriquecer um modelo
// (extrai texto, anonimiza e devolve para salvar no registro)
// ============================================================
export async function extrairTextoDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return anonimizarTexto(value || '');
}

// Classificação leve (para modelos NOVOS criados na importação): detecta rito,
// teses e tomadora por palavras-chave, para o modelo já entrar no matching.
const TESES_KEYWORDS = [
  [/hora[s]? extra/i, 'Horas extras'],
  [/adicional noturno|hora noturna/i, 'Adicional noturno e hora noturna reduzida'],
  [/art\.?\s*71|intrajornada|intervalo (intra|para|de)/i, 'Intervalo intrajornada (art. 71 CLT)'],
  [/folga[s]? trabalhada|\bDSR\b|descanso semanal/i, 'Folgas trabalhadas/DSR'],
  [/dano[s]? moral/i, 'Dano moral'],
  [/s[uú]mula\s*331|subsidi[aá]ri|tomador/i, 'Responsabilidade subsidiária (Súm. 331 TST)'],
  [/insalubr/i, 'Insalubridade'],
  [/periculos/i, 'Adicional de periculosidade'],
  [/desvio de fun/i, 'Desvio de função'],
  [/ac[uú]mulo de fun/i, 'Acúmulo de função'],
  [/rescis[aã]o indireta|art\.?\s*483/i, 'Rescisão indireta (art. 483 CLT)'],
  [/revers[aã]o da (justa causa|dispensa)/i, 'Reversão da justa causa'],
  [/\bFGTS\b/i, 'FGTS + 40%'],
  [/verbas rescis|TRCT|aviso pr[eé]vio/i, 'Verbas rescisórias'],
];

export function classificarTextoModelo(texto) {
  const t = texto || '';
  const teses = TESES_KEYWORDS.filter(([re]) => re.test(t)).map(([, label]) => label);
  const cls = { teses, tem_tomadora: /2[ªa]\s*reclamada|tomador|s[uú]mula\s*331/i.test(t) };
  if (/sumar[ií]ss/i.test(t)) cls.rito = 'sumarissimo';
  else if (/ordin[aá]ri/i.test(t)) cls.rito = 'ordinario';
  if (/rescis[aã]o indireta|art\.?\s*483/i.test(t)) cls.tipo_dispensa = 'rescisao_indireta';
  else if (/revers[aã]o da (justa causa|dispensa)/i.test(t)) cls.tipo_dispensa = 'reversao_justa_causa';
  return cls;
}