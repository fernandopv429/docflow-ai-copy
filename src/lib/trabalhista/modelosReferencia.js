import { base44 } from '@/api/base44Client';
import mammoth from 'mammoth';
import { TIPO_DISPENSA_LABELS } from './tokens';
import { loadTemplateContent } from '@/lib/templateContent';
import { extrairCasoDeTexto } from './parserEntrevista';
import { calcularVerbasCaso } from './mathUtils';
import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';
import { removeTextLetterhead } from '@/lib/removeTextLetterhead';
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

// Carrega o Único MODELO PADRÃO (de "Meus Templates") — traç o HTML formatado
// (estilo/layout do escritório) que serve de base para a minuta.
export async function carregarModeloPadrao() {
  const templates = await base44.entities.Template.list('-updated_date', 100);
  const padrao =
    templates.find((t) => t.is_default === true) ||
    templates.find((t) => /modelo\s*padr[aã]o/i.test(t.title || '')) ||
    templates[0];
  if (!padrao) return null;
  const html = await loadTemplateContent(padrao);
  return { id: padrao.id, titulo: padrao.title, html: html || '' };
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

// ============================================================
// Passo 2: gerar a minuta usando o modelo como referência
// ============================================================
export const PROMPT_SISTEMA_PETICAO = `Você é um assistente jurídico especializado em Direito do Trabalho brasileiro, vinculado ao escritório FAV Advogados. A partir da entrevista do cliente, elabore o TEXTO COMPLETO da petição inicial trabalhista seguindo rigorosamente as regras abaixo.

IDENTIDADE DO ESCRITÓRIO (imutável):
- Advogado: Dr. Fernando Andrade Vieira — OAB/SP nº 320.825
- E-mail: trabalhista@favadvogados.com.br

CABEÇALHO:
- Iniciar direto com o Juízo/Vara/Região. NÃO incluir nome do escritório, logo ou qualquer texto antes disso.

QUALIFICAÇÃO DO RECLAMANTE (ordem obrigatória):
nome completo, nacionalidade, estado civil, função, RG, CPF, PIS, CTPS nº, Série nº, nascido em [data], filho de [filiação], residente e domiciliado em [endereço completo].

RECLAMADAS:
- Usar sempre a razão social oficial e o CNPJ, com endereço completo. Se o CNPJ/endereço não constar da entrevista, inserir marcador [CNPJ - confirmar] / [ENDEREÇO - confirmar].

COMPETÊNCIA TERRITORIAL:
- Identificar o local de prestação de serviços (art. 651 CLT) e indicar a Vara do Trabalho e o TRT correspondentes; se não houver Vara na cidade, indicar o foro vinculado.

CONVENÇÃO COLETIVA (CCT):
- Aplicar a CCT vigente conforme a função e a localidade, identificar o sindicato profissional correto e referenciar as cláusulas ao longo da peça.

TÓPICOS FIXOS (sempre presentes, nesta ordem):
1. Da Competência Processual
2. Da Não Limitação ao Valor da Causa – Estimativa de Valores
3. Do Juízo 100% Digital
4. Da Extinção do Feito sem Julgamento de Mérito
5. Da Justiça Gratuita
6. Do Contrato de Trabalho
7. Do Dano Moral
8. Da Súmula 331 do C. TST
[aqui entram os tópicos conexos aplicáveis ao caso]
... Das Multas Convencionais
... Do FGTS + Multa de 40%
... Do Aviso Prévio Indenizado
... Das Verbas Rescisórias
... Da Multa do Artigo 477 da CLT
... Da Multa do Artigo 467 da CLT
... Dos Honorários Advocatícios – Sucumbência
... Dos Juros de Mora e da Correção Monetária
... Do Desconto do Imposto de Renda
... Da Previdência Social
... Da Expedição de Ofícios
... Dos Pedidos

TÓPICOS CONEXOS À CAUSA DE PEDIR (incluir APENAS os aplicáveis):
Do Desvio de Função; Da Jornada de Trabalho; Das Horas Extras; Da Descaracterização da Jornada 12x36; Do Artigo 71 da CLT (intervalo intrajornada); Do Adicional Noturno e Hora Noturna Reduzida; Do Descanso Semanal Remunerado; Dos Minutos que Antecedem e Sucedem a Jornada; Dos 10 Minutos de Descanso (cláusula CCT); Das Diferenças do Adicional de Periculosidade nas Horas Extras; Das Horas Extras de 100% (folgas/feriados); Da Integração de Valores Remunerados Fora da Folha; Da Ausência de Concessão do Vale-Transporte nas Folgas; Da Ausência de Concessão do Auxílio Alimentação nas Folgas.

DANO MORAL:
- Manter os parágrafos padrão do tópico e acrescentar ao menos um elemento específico do caso concreto. Valor: 10x a maior remuneração do reclamante na função.

CÁLCULOS E VALOR DA CAUSA:
- Calcular todos os pedidos conforme a CLT e a legislação vigente. Discriminar valor principal + cada reflexo (aviso prévio, DSRs, férias+1/3, 13º, FGTS+40%) + total estimado por pedido.
- A somatória total NÃO pode ultrapassar R$ 400.000,00. O valor da causa é a somatória total.

REVISÃO FINAL (garantir antes de responder):
- Cada causa de pedir tem pedido correspondente; CNPJ, endereço, competência e CCT confirmados ou marcados; total ≤ R$ 400.000,00.

REGRAS DE DADOS:
- Use SOMENTE dados da entrevista/documentos do caso atual. Onde faltar um dado, insira marcador entre colchetes (ex.: [SALÁRIO], [DATA DE ADMISSÃO]). NÃO invente fatos nem valores. NÃO narre etapas, verificações ou alterações.

O QUE É PADRÃO (boilerplate — reproduza IGUAL, palavra por palavra, do modelo):
- Endereçamento: "AO JUÍZO DA VARA DO TRABALHO DE SÃO PAULO – SEGUNDA REGIÃO" (ajuste a comarca/região apenas se o local de prestação for outro).
- Fecho da qualificação: "...por seu advogado constituído nos termos do incluso documento de procuração em anexo, com endereço de e-mail: trabalhista@favadvogados.com.br, vem, com fulcro nos artigos 840, §1º, da CLT, c/c 319 do CPC, propor a presente RECLAMAÇÃO TRABALHISTA".
- Bloco de preliminares, SEMPRE nesta ordem: Da Competência Processual → Da Não Limitação ao Valor da Causa (Estimativa) → Do Juízo 100% Digital → Da Extinção do Feito sem Julgamento de Mérito → Da Justiça Gratuita.
- Teses de mérito genéricas com texto praticamente idêntico ao modelo: Do Dano Moral; Da Súmula 331 (responsabilidade subsidiária da tomadora); Do Acúmulo de Função; Da Jornada; Das Horas Extras; Da Descaracterização da Escala 12x36/4x2; Do Artigo 71 (intervalo); Do Adicional Noturno; Dos Minutos que Antecedem/Sucedem; DSR; Folgas/Feriados 100%; Integração do "pagamento por fora"; Vale-Transporte; Auxílio-Alimentação; Multas Convencionais; FGTS+40%; Aviso Prévio; Verbas Rescisórias; Multa 477; Multa 467; IR; Previdência; Expedição de Ofícios; Atribuição Estimativa; Dos Pedidos.
- Jurisprudências, citações de doutrina e quadros sinóticos (tabelas de escala) são copiados do modelo sem alteração.
- Fecho: "Pede deferimento. São Paulo, [data]. FERNANDO ANDRADE VIEIRA – OAB/SP 320.825", com honorários de 20% e Súmulas 425/427 do TST.

O QUE MUDA (variáveis a preencher caso a caso):
- Qualificação do reclamante: nome, RG, CPF, PIS, CTPS, data de nascimento, filiação, endereço e função (ex.: porteiro ou controlador de acesso).
- Qualificação das reclamadas: razão social, CNPJ e endereço (1ª terceirizada / 2ª tomadora).
- Datas de admissão/demissão e o último salário.
- A escala alegada (12x36 ou 4x2) — a seção de descaracterização deve corresponder à escala do caso.
- Rol e valores dos pedidos e o valor da causa.
- O MOTIVO DA SAÍDA determina o "capítulo especial" da peça: justa causa → "Da Reversão da Dispensa por Justa Causa"; rescisão indireta (art. 483) → "Da Rescisão Indireta / Da Falta Grave do Empregador"; pedido de demissão sob coação → narrativa de coação/ameaça; sem justa causa → NENHUM capítulo de reversão/rescisão indireta (peça mais curta).
- Teses "avulsas" ligadas ao caso concreto (ex.: periculosidade, doença ocupacional, estabilidade provisória, pensão vitalícia) entram APENAS quando houver suporte no relato.

Em resumo: cerca de 80–85% do texto é modelo fixo — o que varia é a qualificação das partes, datas/salário, o motivo da rescisão (que puxa o capítulo correspondente) e os valores.`;

// Bloco de cálculos determinísticos para o prompt (mesma lógica da auditoria).
function blocoCalculos(calculos) {
  if (!calculos?.length) return '';
  const linhas = calculos.map(
    (c) => `- ${c.item}: ${c.valor != null ? `R$ ${c.valor.toFixed(2)}` : '—'} (${c.memoria})`
  );
  return `\n\nCÁLCULOS DETERMINÍSTICOS (feitos por código, matematicamente exatos — USE EXATAMENTE estes valores no texto e nos pedidos; NÃO faça aritmética própria nem altere estes números. Some-os para compor o VALOR DA CAUSA, respeitando o teto de R$ 400.000,00):\n${linhas.join('\n')}`;
}

// Geração adaptando o MODELO PADRÃO (HTML formatado), preservando o estilo.
export function buildGeracaoPadraoPrompt({ texto, attrs, modeloHtml, calculos, diferencial, modeloSemelhanteTitulo, dadosReceita, dadosCep, dadosDatajud }) {
  return `${PROMPT_SISTEMA_PETICAO}

REGRA PRINCIPAL — ADAPTE O MODELO PADRÃO MANTENDO O ESTILO: abaixo está o MODELO PADRÃO do escritório em HTML (com a formatação, o layout e o texto-padrão corretos, podendo conter marcadores como {{VARIAVEL}}). Sua tarefa é ADAPTAR este HTML ao caso atual:
- Substitua os marcadores {{...}} e quaisquer dados de exemplo pelos dados REAIS do caso (entrevista/documentos). Onde faltar um dado, deixe um marcador claro entre colchetes, ex.: [SALÁRIO].
- Ajuste ou REMOVA os tópicos que não se aplicam ao caso; mantenha os tópicos fixos.
- Todo valor que você preencher ou substituir com dados do caso atual deve ficar envolvido por <mark class="ai-filled-field" data-ai-field="nome_do_campo">valor preenchido</mark>. Marque somente os dados variáveis inseridos por você, nunca o texto jurídico padrão.
- MANTENHA EXATAMENTE a formatação e a estrutura HTML do modelo (mesmas tags e estilos). NÃO reescreva o texto-padrão nem crie estrutura nova.

=== MODELO PADRÃO (HTML — preserve a formatação) ===
${modeloHtml}
=== FIM DO MODELO PADRÃO ===
${diferencial ? `\n=== CASO SEMELHANTE NA BASE${modeloSemelhanteTitulo ? ` (${modeloSemelhanteTitulo})` : ''} — DIFERENCIAL ===\nO sistema selecionou, na base de referências, o caso mais semelhante a esta entrevista. Use os pontos PARTICULARES abaixo como orientação para as teses/capítulos específicos deste tipo de caso (o restante segue o Modelo Padrão). Inclua apenas o que tiver suporte no relato:\n${diferencial}\n=== FIM DO DIFERENCIAL ===\n` : ''}
=== ENTREVISTA / CASO ATUAL ===
${texto || '(ver documentos anexados)'}

Atributos detectados: função=${attrs?.funcao || '-'}, modalidade=${attrs?.tipo_dispensa || '-'}, rito=${attrs?.rito || '-'}, tomadora=${attrs?.tem_tomadora ? 'sim' : 'não'}.
=== FIM DA ENTREVISTA ===${blocoReceita(dadosReceita)}${blocoCeps(dadosCep)}${blocoDatajud(dadosDatajud)}${blocoCalculos(calculos)}

FORMATO DE SAÍDA: retorne APENAS o HTML adaptado do corpo da petição (sem <html>, <head> ou <body>), PRESERVANDO a formatação/estilo do modelo. NÃO acrescente avisos, notas ou observações ao final.`;
}

// Limpa a saída da IA: remove cercas de código markdown (```html) e tags de
// envelope (<html>/<head>/<body>) que aparecem como texto no preview/export.
export function limparHtmlIA(html) {
  let t = typeof html === 'string' ? html : String(html || '');
  t = t.replace(/```[a-z]*\n?/gi, '');
  t = t.replace(/<\/?(?:html|head|body|!doctype)[^>]*>/gi, '');
  t = t.replace(/<p>\s*<em>\s*⚠️[^<]*<\/em>\s*<\/p>/gi, '');
  return removeTextLetterhead(t.trim());
}

export async function gerarPecaPadrao({ texto, fileUrls, attrs, modeloPadrao, onTool, force = false }) {
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
  // Extração estruturada do caso (parser) para alimentar o cálculo determinístico.
  if (texto && texto.trim()) notify('Extraindo dados do caso e calculando verbas (determinístico)...');
  const [dadosReceita, dadosCep, dadosDatajud, caso] = await Promise.all([
    enriquecerCnpjs(cnpjs),
    enriquecerCeps(ceps),
    enriquecerDatajud(attrs, config),
    texto && texto.trim()
      ? withRuntimeCache('extracao-caso', runtimeCacheKey(texto), () => extrairCasoDeTexto(texto), {
          onHit: () => notify('Reutilizando análise estruturada da entrevista em cache...'),
        }).catch(() => ({}))
      : Promise.resolve({}),
  ]);

  // Cálculo 100% determinístico (a IA não faz aritmética).
  const calculos = calcularVerbasCaso(caso || {});

  // Seleciona o modelo de referência mais semelhante (matching determinístico) → usa seu diferencial.
  let modeloSemelhante = null;
  let diferencial = '';
  try {
    const modelos = await listarModelosAtivos();
    const ranking = rankearModelos(modelos, attrs || {});
    if (ranking[0] && ranking[0].score > 0) {
      modeloSemelhante = ranking[0].modelo;
      diferencial = modeloSemelhante.diferencial || modeloSemelhante.conteudo || modeloSemelhante.resumo || '';
      if (modeloSemelhante.titulo) notify(`Referência mais semelhante: ${modeloSemelhante.titulo}`);
    }
  } catch (e) {
    /* segue sem referência */
  }

  const req = {
    prompt: buildGeracaoPadraoPrompt({
      texto,
      attrs,
      modeloHtml: modeloPadrao?.html || '',
      calculos,
      diferencial,
      modeloSemelhanteTitulo: modeloSemelhante?.titulo || '',
      dadosReceita,
      dadosCep,
      dadosDatajud,
    }),
    model: 'claude_sonnet_4_6',
  };
  const urls = [...(fileUrls || [])];
  if (urls.length) req.file_urls = urls;
  const resultado = await withRuntimeCache(
    'geracao-minuta',
    runtimeCacheKey({ prompt: req.prompt, fileUrls: urls }),
    () => traceAiCall('Geração da minuta', req, () => base44.integrations.Core.InvokeLLM(req)),
    { onHit: () => notify('Reutilizando geração idêntica em cache...'), force }
  );
  return {
    html: limparHtmlIA(resultado),
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

export async function verificarCoerencia({ texto, caso, html }) {
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
RELATO/ENTREVISTA: """${texto || ''}"""
MINUTA GERADA (HTML): """${html || ''}"""

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