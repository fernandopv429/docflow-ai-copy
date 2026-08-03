import { base44 } from '@/api/base44Client';
import mammoth from 'mammoth';
import { TIPO_DISPENSA_LABELS } from './tokens';
import { loadTemplateContent } from '@/lib/templateContent';
import { extrairCasoDeTexto } from './parserEntrevista';
import { calcularVerbasCaso, round2 } from './mathUtils';
import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';
import { removeTextLetterhead } from '@/lib/removeTextLetterhead';
import { blocoRegrasCriticas, regiaoTrtPorMunicipio } from './regrasCriticas';
import { BLOCO_ENGENHARIA_JURIDICA } from './engenhariaJuridica';
import { BLOCO_REGRAS_QUALIDADE } from './regrasQualidadeFav';
import { invokeLLMComRetry } from './llmRetry';
import { aplicarFormatacaoPadrao, aplicarFechoDeterministico, removerPedidosZerados, esqueletoDoModelo } from './formatacaoPeca';
import { traceAiCall } from '@/lib/sessionTrace';
import {
  consultarCnpj,
  enriquecerCnpjs,
  extrairCnpjs,
  consultarCep,
  enriquecerCeps,
  extrairCeps,
  CONFIG_INTEGRACOES_PADRAO,
  carregarConfigIntegracoes,
  montarTermosDatajud,
  consultarDatajud,
  enriquecerDatajud,
  categoriaCct,
  consultarCct,
  perguntasCct,
  enriquecerCct,
} from './consultas';

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

ATENÇÃO AO FORMATO DAS ENTREVISTAS: o advogado costuma escrever em lista de rótulos. A DATA DE SAÍDA aparece frequentemente rotulada pela própria modalidade da rescisão — ex.: "Sem JUSTA CAUSA: 07/12/2025", "Rescisão indireta: 10/03/2025", "Pedido de demissão: 01/02/2025". Nesses casos, a data é a DATA DE RESCISÃO e o rótulo indica o tipo_dispensa. Nunca diga que a data de rescisão está faltando quando ela aparece nesse formato. Da mesma forma, "Jornada: 12x36 18:30 as 07:30" é a jornada/escala e "Salário: 2148,22" é o salário.

Extraia em "atributos" TUDO o que já for possível inferir da conversa. Nunca devolva "atributos" vazio quando o relato contiver função, CNPJ, CEP, tomadora, rito ou teses. Considere como teses fatos como dano moral, intervalo reduzido, folgas trabalhadas e jornada extraordinária. Defina "pronto_para_gerar" como true quando o advogado pedir a minuta OU quando já houver identificação do reclamante, função, reclamada, datas do contrato, salário, jornada e fatos essenciais. Não invente dados.

MODELOS DE REFERÊNCIA DISPONÍVEIS (o sistema escolherá automaticamente o mais aderente aos atributos):
${resumoModelos(modelos)}

ATRIBUTOS JÁ CONFIRMADOS EM ETAPAS ANTERIORES:
${JSON.stringify(attrsAtuais || {})}

CONVERSA ATÉ AGORA:
${formatarTranscript(transcript)}

Responda APENAS com o objeto JSON.`;
}

// Rótulos usados na prática para a data de saída. Inclui a modalidade como
// rótulo ("Sem justa causa: 07/12/2025"), formato comum nas entrevistas.
const RESCISAO_RE = /(?:demiss[aã]o|rescis[aã]o|dispensa|desligamento|sa[íi]da|t[eé]rmino|(?:sem\s+)?justa\s+causa|pedido\s+de\s+demiss[aã]o|acordo)\s*:?\s*(?:em\s*)?(\d{2}\/\d{2}\/\d{4})/i;

const MODALIDADE_RE = [
  [/rescis[aã]o\s+indireta|art\.?\s*483/i, 'rescisao_indireta'],
  [/revers[aã]o\s+da\s+(?:justa\s+causa|dispensa)/i, 'reversao_justa_causa'],
  [/nulidade\s+do\s+pedido\s+de\s+demiss[aã]o|coa[çc][aã]o/i, 'nulidade_pedido_demissao'],
  [/sem\s+justa\s+causa/i, 'sem_justa_causa'],
  [/acordo\s*(?:art\.?\s*484|:)/i, 'acordo'],
];

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

  const modalidade = MODALIDADE_RE.find(([re]) => re.test(texto))?.[1];
  const atributos = {
    ...(funcao && { funcao }),
    ...(modalidade && { tipo_dispensa: modalidade }),
    cnpjs: extrairCnpjs(texto),
    ceps: extrairCeps(texto),
    tem_tomadora: /2[ªa]\s*reclamada|tomadora/i.test(texto),
    teses,
  };
  const faltando = [];
  if (!funcao) faltando.push('Função do reclamante');
  if (!atributos.cnpjs.length) faltando.push('CNPJ da(s) reclamada(s)');
  if (!/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(texto)) faltando.push('CPF do reclamante');
  if (!/admiss[aã]o\s*:?\s*\d{2}\/\d{2}\/\d{4}/i.test(texto)) faltando.push('Data de admissão');
  if (!RESCISAO_RE.test(texto)) faltando.push('Data de rescisão/demissão');
  if (!/sal[aá]rio\s*:?\s*(?:r\$\s*)?[\d.,]+/i.test(texto)) faltando.push('Salário');
  if (!/(?:escala|hor[aá]rio|jornada)\s*:?/i.test(texto)) faltando.push('Jornada/escala de trabalho');
  const essenciais = !faltando.length;
  return {
    atributos,
    essenciais,
    faltando,
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
  const key = runtimeCacheKey({ version: 6, transcript: transcriptCompacto, fileUrls, modelos, attrsAtuais });
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

  // Consulta SEMPRE os CNPJs na Receita — os dados oficiais completam
  // endereço/CEP das reclamadas e são exibidos no chat.
  const dadosReceita = (atributos.cnpjs || []).length
    ? await enriquecerCnpjs(atributos.cnpjs)
    : [];
  const verificados = dadosReceita.filter((d) => !d.erro);
  for (const d of verificados) {
    const cepOficial = (d.cep || '').replace(/\D/g, '');
    if (cepOficial.length === 8) atributos.ceps = [...new Set([...(atributos.ceps || []), cepOficial])];
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
  if (verificados.length) {
    reply += `\n\nDados oficiais da Receita Federal:\n${verificados
      .map((d) => `• ${d.razao_social} — CNPJ ${d.cnpj}, ${d.endereco}, CEP ${d.cep}`)
      .join('\n')}`;
  }
  const faltando = inferido.faltando || [];
  if (faltando.length && !inferido.pendencias.length) {
    reply += `\n\nAinda falta: ${faltando.join('; ')}.`;
  }
  return { ...resposta, reply, atributos, pronto_para_gerar: pronto, faltando, dadosReceita };
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

function blocoCeps(dados) {
  if (!dados?.length) return '';
  const linhas = dados.map((d) =>
    d.erro
      ? `- CEP ${d.cep}: ${d.erro} — confirme o endereço.`
      : `- CEP ${d.cep}: ${[d.logradouro, d.bairro, [d.municipio, d.uf].filter(Boolean).join('/')].filter(Boolean).join(', ')}.`
  );
  return `\n\nENDEREÇOS VERIFICADOS POR CEP (ViaCEP — use para completar logradouro/bairro/município/UF na qualificação; o município orienta a Vara do Trabalho e o UF o TRT da competência):\n${linhas.join('\n')}`;
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

function blocoCct(dadosCct) {
  if (!dadosCct?.clausulas?.length) return '';
  const m = dadosCct.meta;
  const local = dadosCct.municipio ? ` — base territorial: ${dadosCct.municipio}/${dadosCct.uf || ''}` : '';
  const cab = m
    ? `CONVENÇÃO COLETIVA APLICÁVEL${local} — ${m.titulo || 'CCT'}${m.ano_base ? `, ano-base ${m.ano_base}` : ''}${m.vigencia_inicio ? ` (vigência ${m.vigencia_inicio}${m.vigencia_fim ? ` a ${m.vigencia_fim}` : ''})` : ''}${m.sindicato_laboral ? `; sindicato profissional: ${m.sindicato_laboral}` : ''}`
    : 'CLÁUSULAS DE CONVENÇÃO COLETIVA (CCT) APLICÁVEIS';
  const linhas = dadosCct.clausulas.slice(0, 5).map((c) => {
    const ref = [c.clausula_ref, c.clausula_titulo].filter(Boolean).join(' — ') || '•';
    const texto = (c.texto || c.conteudo || c.trecho || c.clausula_texto || c.resumo || '')
      .toString().trim().replace(/\s+/g, ' ').slice(0, 350);
    return `- ${ref}: ${texto}`;
  });
  return `\n\n${cab}\nUSE as cláusulas REAIS abaixo (fonte: base de CCTs do escritório) para fundamentar os tópicos de convenção coletiva (adicional noturno, auxílio-alimentação/refeição, vale-transporte, multa convencional, intervalo, horas extras). Cite a cláusula pelo número quando disponível. NÃO invente cláusulas que não constem aqui:\n${linhas.join('\n')}`;
}

// ============================================================
// Passo 2: gerar a minuta usando o modelo como referência
// ============================================================
export const PROMPT_SISTEMA_PETICAO = `Você é um assistente jurídico sênior especializado em Direito do Trabalho, atuando em nome do escritório FAV Advogados.

Sua tarefa é receber os dados extraídos de uma entrevista trabalhista e gerar a PETIÇÃO INICIAL COMPLETA, seguindo estritamente a estrutura, o tom, o estilo e os tópicos do MODELO PADRÃO DO ESCRITÓRIO.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTIDADE INSTITUCIONAL E NOTIFICAÇÕES (IMUTÁVEL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Patronos: Dr. Fernando Andrade Vieira — OAB/SP nº 320.825
- E-mail do Escritório (Intimações/Comunicações): trabalhista@favadvogados.com.br
- Publicações: Exclusivamente em nome do Dr. Fernando Andrade Vieira, OAB/SP nº 320.825, nos termos da Súmula 427 do C. TST.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTRUTURA E ESTILO DE REDAÇÃO (SEGUIR EXATAMENTE O MODELO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ENDEREÇAMENTO:
   - "AO MM. JUÍZO DA VARA DO TRABALHO DE [CIDADE/FORO] – [REGIÃO] REGIÃO"
   - Regra de Competência: Grande SP (Itapecerica da Serra, Osasco, Guarulhos, ABC, SP Capital) = SEGUNDA REGIÃO.

2. PREÂMBULO E QUALIFICAÇÃO DO RECLAMANTE:
   - Formato: [NOME RECLAMANTE], nascido em [DATA], [nacionalidade], [estado civil], [função], portador da cédula de identidade com CPF/MF nº [CPF], PIS nº [PIS], CTPS nº [CTPS] Série nº [SÉRIE], filho de [NOME MÃE] E [NOME PAI], residente e domiciliado na [ENDEREÇO COMPLETO], e-mail: [EMAIL PESSOAL DO CLIENTE], por seu advogado constituído... com endereço eletrônico: trabalhista@favadvogados.com.br, vem propor RECLAMAÇÃO TRABALHISTA...
   - REGRA CRÍTICA: O e-mail do cliente (ex.: cliente@gmail.com) vai na qualificação do Reclamante. O e-mail do escritório (trabalhista@favadvogados.com.br) vai APENAS no endereço do advogado.

3. QUALIFICAÇÃO DAS RECLAMADAS:
   - 1ª RECLAMADA: [Razão Social Oficial], CNPJ/MF nº [CNPJ], situada na [Endereço Completo com CEP].
   - 2ª RECLAMADA (se houver tomadora): [Razão Social da Tomadora], CNPJ/MF nº [CNPJ], situada na [Endereço Completo com CEP].

4. TÓPICOS DA CAUSA DE PEDIR (Usar Títulos em Negrito e Caixa Alta com marcadores '-'):
   Sempre Presentes:
   - DA COMPETÊNCIA PROCESSUAL (art. 651 da CLT)
   - DA NÃO LIMITAÇÃO AO VALOR DA CAUSA – ESTIMATIVA DE VALORES (art. 840, § 1º, CLT + IN 41/2018 TST)
   - DO JUÍZO 100% DIGITAL
   - DA EXTINÇÃO DO FEITO SEM JULGAMENTO DE MÉRITO (arts. 317 a 321 do CPC)
   - DA JUSTIÇA GRATUITA (art. 98 do CPC e art. 790, §§ 3º e 4º, da CLT)
   - DO CONTRATO DE TRABALHO (Datas de admissão, demissão/reversão, função e último salário com valor por extenso)
   - DO DANO MORAL (Arts. 5º, V/X da CF e 186/927/932 do CC + Citação Doutrinária da Dra. Martha Halfed. Indenização = 10x o salário do autor)
   - DA SÚMULA 331 DO C. TST (Somente se houver 2ª Reclamada tomadora — a responsabilidade da tomadora é SUBSIDIÁRIA, nunca solidária, salvo grupo econômico relatado na entrevista. USE SEMPRE "subsidiariamente"/"responsabilidade subsidiária" de forma consistente em TODO o texto — inclusive no rol de pedidos e nos requerimentos finais. É PROIBIDO escrever "solidária e/ou subsidiariamente" ou "solidária" para a 2ª Reclamada tomadora, pois mistura dois institutos jurídicos distintos.)
   - DOS HONORÁRIOS ADVOCATÍCIOS – SUCUMBÊNCIA (Artigo 791-A da CLT a 15% sobre o valor que resultar da liquidação da sentença ou do proveito econômico obtido — use o valor da causa apenas como base subsidiária, quando não for possível mensurar o proveito econômico; NÃO escreva "15% sobre o valor da causa" como regra geral)
   - DOS JUROS DE MORA E DA CORREÇÃO MONETÁRIA (ADC 58/59 STF — IPCA-E na fase pré-judicial e SELIC a partir do ajuizamento)
   - DO DESCONTO DO IMPOSTO DE RENDA
   - DA PREVIDÊNCIA SOCIAL
   - DA EXPEDIÇÃO DE OFÍCIOS (MTE, INSS, CEF, DRT)
   - DA ATRIBUIÇÃO ESTIMATIVA AOS PEDIDOS

   Conforme o Caso Concreto (Mérito do Vigilante/Trabalhador):
   - DO DESVIO DE FUNÇÃO (Vigilante executando Prevenção de Perdas/Conferência — Multa da CCT de 50%/mês. Se o valor "Desvio de função (50%/mês)" já vier pronto em CÁLCULOS DETERMINÍSTICOS, USE EXATAMENTE ESSE VALOR — NÃO calcule por conta própria; se não vier, estime com base nos meses reais do contrato informados na entrevista.)
   - DA GRATIFICAÇÃO DE FUNÇÃO (Se houver condução de veículo — 10% da CCT)
   - DA JORNADA DE TRABALHO
   - DAS HORAS EXTRAS (Excedentes da 8ª diária e 44ª semanal, com o ADICIONAL CONVENCIONAL REAL da CCT vigente informado no bloco CONVENÇÃO COLETIVA; nunca presuma um percentual — na falta, use [adicional conforme CCT])
   - DA DESCARACTERIZAÇÃO DA JORNADA DE TRABALHO NO REGIME 12 X 36 (Com citação da Súmula 85 do TST — REGRA DE BIS IN IDEM: este tópico é a FUNDAMENTAÇÃO para ampliar a base das horas extras já pedidas em "DAS HORAS EXTRAS" (todo o sobrelabor passa a ser extra, não só o excedente da escala) — NÃO é um pedido monetário adicional e separado. NO ROL DE PEDIDOS, não crie uma linha própria com valor para a descaracterização do 12x36; incorpore o efeito dela ao valor de "Horas extras" ou registre como "incluído no item de horas extras (sem bis in idem)", sem soma adicional.)
   - DO ARTIGO 71 DA CLT (Intervalo intrajornada suprimido — peça o período suprimido + adicional convencional, COM reflexos em DSR, férias + 1/3, 13º salário, aviso prévio e FGTS + 40%, como no modelo padrão do escritório.)
   - DO ADICIONAL NOTURNO E HORA NOTURNA REDUZIDA (SOMENTE quando a jornada informada abranger, total ou substancialmente, o período das 22h às 5h — ex.: escala 12x36 iniciando à noite/madrugada. Baseie-se EXCLUSIVAMENTE no horário de início/fim informado na entrevista para decidir. É PROIBIDO inventar sobrelabor, prorrogação de jornada ou folgas trabalhadas além das 22h para justificar a inclusão deste tópico — se a jornada informada for exclusivamente diurna (mesmo que haja folgas trabalhadas ou horas extras que NÃO foram ditas noturnas), OMITA este tópico por completo, sem exceção. Quando aplicável: adicional de 20% sobre as horas noturnas + hora noturna reduzida de 52min30s — art. 73, §5º, CLT; Súmula 60, II, do C. TST; e Súmula 91 do C. TST contra a tese de salário complessivo)
   - DOS MINUTOS QUE ANTECEDEM E SUCEDEM A JORNADA DE TRABALHO (Padrão da categoria de vigilância em qualquer escala com posto armado: 30min antes (preleção, troca de farda/armamento) + 30min depois (espera pela rendição) — inclua sempre que a função for de vigilância/segurança, mesmo sem relato explícito disso na entrevista, salvo se a entrevista disser expressamente que não havia essa prática.)
   - DO DESCANSO SEMANAL REMUNERADO (DSR) (SOMENTE crie um pedido AUTÔNOMO de DSR quando houver uma causa PRÓPRIA e distinta dos reflexos já pedidos em outros itens — ex.: erro direto no pagamento do DSR em si. É PROIBIDO fundamentar um pedido autônomo de DSR dizendo que decorre "das horas extras habituais não computadas na base de cálculo" — isso já é o reflexo em DSR que cada item de horas extras/adicional noturno/etc. já pede individualmente; repetir como pedido separado é bis in idem. Se a única causa for essa, OMITA o tópico autônomo de DSR e mantenha apenas os reflexos já embutidos nos demais itens.)
   - DOS 10 (DEZ) MINUTOS DE DESCANSO, CONFORTO, HIGIENE E SEGURANÇA DO TRABALHO (Cláusula da CCT de vigilância — padrão da categoria quando o vigilante permanece em pé/continuamente no posto: inclua sempre que a categoria for vigilância armada, mesmo sem relato explícito — é cumulativo com o intervalo intrajornada do art. 71 CLT, que é outro direito. NÃO inclua se a categoria/CCT não for a de vigilância —ex.: porteiro sob SINDEEPRES.)
   - DAS DIFERENÇAS DOS PAGAMENTOS DO ADICIONAL DE PERICULOSIDADE NAS HORAS EXTRAS (Súmula 132, I, TST; OJ 259 SDI-1 — padrão da categoria para VIGILANTE ARMADO, que é legalmente atividade perigosa: inclua sempre que a função for vigilante/vigia armado, mesmo sem relato explícito de que já recebe periculosidade — é presunção legal da função, não depende de confirmação do cliente. Não inclua para funções sem exposição a risco, como porteiro/controlador de acesso desarmado.)
   - DAS HORAS EXTRAS DE 100% (Folgas e Feriados laborados — Súmula 444 do TST)
   - DA INTEGRAÇÃO DOS VALORES REMUNERADOS FORA DA FOLHA DE PAGAMENTO (Valores pagos pelas FTs em dinheiro/PIX)
   - DA AUSÊNCIA DE CONCESSÃO DO VALE TRANSPORTE NAS FOLGAS TRABALHADAS (Padrão da categoria sempre que houver folgas trabalhadas (FTs): inclua mesmo sem relato explícito de uso de transporte público — use o padrão de R$ 10,00/dia (2 conduções de R$ 5,00) quando o valor não for informado.)
   - DA AUSÊNCIA DE CONCESSÃO DO AUXÍLIO ALIMENTAÇÃO NAS FOLGAS TRABALHADAS (Padrão da categoria sempre que houver folgas trabalhadas (FTs): inclua mesmo sem relato explícito — use o valor da CCT vigente por dia.)
   - DA ASSIDUIDADE (SOMENTE quando houver prêmio de assiduidade prometido/previsto em CCT e pago a menor ou suprimido — use o valor já calculado deterministicamente em CÁLCULOS DETERMINÍSTICOS, se presente; não invente um valor de prêmio que não conste da entrevista)
   - DAS MULTAS CONVENCIONAIS (use o NÚMERO da cláusula e o PERCENTUAL REAIS da CCT vigente fornecida no bloco CONVENÇÃO COLETIVA; é PROIBIDO inventar percentual/cláusula — se a CCT não constar, use o marcador [cláusula/percentual conforme CCT])
   - DOS FGTS + MULTA DE 40% (Art. 18 da Lei 8.036/90)
   - DO AVISO PRÉVIO INDENIZADO (Lei 12.506/11)
   - DAS VERBAS RESCISÓRIAS (Se os valores "Saldo de salário", "Aviso prévio indenizado", "13º proporcional", "Férias proporcionais + 1/3" já vierem prontos em CÁLCULOS DETERMINÍSTICOS, USE EXATAMENTE ESSES VALORES — NÃO calcule o saldo de salário por conta própria, nem arredonde os dias.)
   - DA MULTA DO ARTIGO 477 DA CLT
   - DA MULTA DO ARTIGO 467 DA CLT (50% sobre as verbas rescisórias INCONTROVERSAS — saldo de salário + aviso prévio + 13º + férias +1/3, NÃO apenas 1 salário. Se o valor "Multa do art. 467 da CLT" já vier pronto em CÁLCULOS DETERMINÍSTICOS, USE EXATAMENTE ESSE VALOR.)

5. ROL DE PEDIDOS (DOS PEDIDOS):
   - Estruturar em tópicos com marcadores de hifen '-', indicando cada pedido principal e seus respectivos reflexos individualizados (DSRs, Aviso Prévio, Férias + 1/3, 13º Salário, FGTS + Multa de 40%).
   - Indicar claramente o valor estimado por item (um único valor final por item, já somando os reflexos DESSE item — nunca deixe o valor do item "solto" em vários pedaços).
   - NÃO escreva a frase final "Dá-se à causa o valor de..." nem calcule/some o total — isso é feito por código depois da sua resposta (ver CONTRATO DE SAÍDA no final deste prompt).

6. REQUERIMENTOS FINAIS (SEM FECHO — O FECHO É GERADO POR CÓDIGO):
   - Notificação das Reclamadas sob pena de confissão (Súmula 74 TST).
   - Indicação do endereço eletrônico do patrono: trabalhista@favadvogados.com.br.
   - Requerimento de intimações exclusivamente em nome do Dr. Fernando Andrade Vieira, OAB/SP nº 320.825 (Súmula 427 do TST).
   - NÃO escreva "Pede deferimento", a data do fecho ("São Paulo, ...") nem a assinatura — o sistema insere essas três linhas automaticamente, sempre com a data correta. Encerre seu texto no último requerimento final.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRAVAS CRÍTICAS ANTI-ERRO (NÃO DESCUMPRIR)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. HONORÁRIOS NO ENCERRAMENTO: Nos honorários sucumbenciais use a fundamentação do art. 791-A da CLT. NUNCA cite a Súmula 425 do TST para pedir honorários no encerramento (a Súmula 425 trata de jus postulandi).
2. DESVIO DE FUNÇÃO — DESCRIÇÃO CONCRETA: ao redigir o tópico do desvio de função, transcreva as ATIVIDADES efetivamente relatadas na entrevista (ex.: prevenção de perdas — conferência de cargas, controle/verificação de validade de produtos, contagem de paletes, registros operacionais). É PROIBIDO deixar a frase incompleta (ex.: "além das funções de VIGILANTE, ,") ou sem a lista de tarefas desviadas.
3. AVOS PROPORCIONAIS: os avos do 13º e das férias proporcionais escritos no TEXTO devem corresponder aos meses efetivamente trabalhados no período aquisitivo (admissão → saída, com projeção do aviso prévio). Ex.: admissão 14/04 e saída 07/12 = 9/12. NUNCA escreva "11/12" ou "12/12" quando o contrato não alcançou esses meses; os avos narrados devem coincidir com os valores calculados de forma determinística.
4. VALOR DA CAUSA NO CORPO: você NÃO sabe o valor total da causa (ele só existe depois que o código soma os itens que você listar). Por isso, em qualquer menção ao "valor da causa" ou à base de cálculo dos honorários, NÃO escreva um número — refira-se a ele apenas como "o valor da causa"/"o valor total da condenação", sem cifra. NUNCA reproduza um valor antigo herdado do modelo (ex.: "R$ 10.012,79").
5. JUÍZO 100% DIGITAL × E-MAIL DO CLIENTE: se o reclamante possui e-mail (informado na entrevista), NÃO afirme que "o autor não possui correio eletrônico". Ajuste o parágrafo para indicar o e-mail do cliente na qualificação e apenas o encaminhamento/ciência pelo patrono, sem afirmação falsa.
6. CONCORDÂNCIA DE GÊNERO: revise CADA ocorrência (contratado/a, ligado/a, prejudicado/a, deferido(s) ao/à reclamante) para o gênero do reclamante informado. Não deixe flexões do modelo no gênero oposto nem formas como "brasileiro(a)".
7. SAÍDA DIRETA: Entregue diretamente o texto da petição pronta para uso, sem comentários iniciais ou explicações ao final.
8. CONTRATO DE SAÍDA — VALORES DOS PEDIDOS (OBRIGATÓRIO E LITERAL): imediatamente após o último requerimento final, sem NENHUM texto entre eles (nem "Pede deferimento", nem data, nem assinatura), inclua uma única linha no formato EXATO abaixo:
<!--PEDIDOS_VALORES:[valor1,valor2,valor3]-->
Regras desse array: um número por PEDIDO PRINCIPAL do rol (na mesma ordem em que você os listou), já somando os reflexos daquele mesmo item; SEM separador de milhar; ponto como separador decimal; SEM o símbolo R$; SEM aspas; NÃO inclua o percentual/valor de honorários advocatícios neste array (são calculados à parte, sobre o valor da causa). NÃO escreva nada depois dessa linha — ela deve ser o último caractere da sua resposta.`;

// Bloco de cálculos determinísticos para o prompt (mesma lógica da auditoria).
function blocoCalculos(calculos) {
  if (!calculos?.length) return '';
  const linhas = calculos.map(
    (c) => `- ${c.item}: ${c.valor != null ? `R$ ${c.valor.toFixed(2)}` : '—'} (${c.memoria})`
  );
  return `\n\nCÁLCULOS DETERMINÍSTICOS (feitos por código, matematicamente exatos — USE EXATAMENTE estes valores no texto e nos pedidos; NÃO faça aritmética própria nem altere estes números. Some-os para compor o VALOR DA CAUSA, respeitando o teto de R$ 400.000,00):\n${linhas.join('\n')}`;
}

// HTML vindo de DOCX é muito verboso (comentários, estilos "mso", espaços).
// Compactar reduz drasticamente o prompt — o que evita estouro de tempo na IA —
// sem alterar a formatação visível do modelo.
export function compactarHtmlModelo(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/\s(?:lang|xml:lang|dir|data-[\w-]+)="[^"]*"/gi, '')
    .replace(/mso-[a-z-]+\s*:\s*[^;"']+;?/gi, '')
    .replace(/style="\s*"/gi, '')
    .replace(/>\s+</g, '> <')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Geração adaptando o MODELO PADRÃO (HTML formatado), preservando o estilo.
export function buildGeracaoPadraoPrompt({ texto, attrs, modeloHtml, calculos, referencias, dadosReceita, dadosCep, dadosDatajud, dadosCct }) {
  const municipios = [...new Set((dadosCep || []).map((d) => d.municipio).filter(Boolean))];
  const dataHoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const blocoReferencias = (referencias || []).length
    ? `\n=== CASOS SEMELHANTES NA BASE (${referencias.length}) — DIFERENCIAL ===\nO sistema selecionou, na base de referências, os casos mais semelhantes a esta entrevista (do mais para o menos parecido). Use os pontos PARTICULARES abaixo como orientação para as teses/capítulos específicos deste tipo de caso (o restante segue o Modelo Padrão). Se dois casos indicarem abordagens diferentes para o mesmo tema, priorize o PRIMEIRO (mais semelhante). Inclua apenas o que tiver suporte no relato desta entrevista:\n${referencias
        .map((r, i) => `--- Referência ${i + 1}${r.titulo ? ` (${r.titulo})` : ''} ---\n${r.diferencial}`)
        .join('\n\n')}\n=== FIM DOS DIFERENCIAIS ===\n`
    : '';
  return `${PROMPT_SISTEMA_PETICAO}${BLOCO_ENGENHARIA_JURIDICA}${BLOCO_REGRAS_QUALIDADE}${blocoRegrasCriticas({ municipios, dataHoje })}

REGRA PRINCIPAL — ESCREVA APENAS O CONTEÚDO: a formatação (fonte, alinhamento, títulos, timbrado) é aplicada depois por código. Você NÃO deve reproduzir estilos, CSS, tabelas de layout ou atributos style.
- Use HTML simples e semântico: <p> para parágrafos, <h2> para os títulos dos tópicos (em CAIXA ALTA), <ul>/<li> para listas de pedidos, <strong> para ênfase, <blockquote> para citações.
- LEGIBILIDADE (OBRIGATÓRIO): cada parágrafo em seu próprio <p>, com no máximo 5 a 6 linhas — divida ideias complexas em vários <p> curtos. É PROIBIDO entregar blocos densos e contínuos de texto nas teses e na narrativa dos fatos.
- ROL DE PEDIDOS — ESTRUTURA HIERÁRQUICA (OBRIGATÓRIO): cada pedido principal em seu próprio <li> (nunca vários pedidos no mesmo item) e NUNCA em uma única linha densa. Quando o pedido tiver reflexos/desdobramentos, use um <ul> aninhado dentro do <li>, exatamente neste padrão:
<li><strong>NOME DO PEDIDO</strong>: descrição sucinta da verba principal — <strong>R$ valor principal</strong>:
  <ul><li>Reflexo em DSR: R$ valor;</li><li>Reflexo em férias + 1/3: R$ valor;</li><li>Reflexo em 13º salário: R$ valor;</li><li>Reflexo em FGTS + 40%: R$ valor;</li><li><strong>VALOR TOTAL DO ITEM: R$ valor total do pedido.</strong></li></ul></li>
- Quadros de jornada/escala (12x36, 4x2 etc.) devem ficar em uma <table> própria, isolada do texto (o código aplica o espaçamento).
- É PROIBIDO inserir linhas horizontais, divisores ou traços de separação entre as seções (<hr>, "---", "___", bordas). O modelo do escritório não usa divisores.
- EMENTAS/JULGADOS: transcreva a ementa em um <blockquote> (o código aplica Arial 12, itálico e recuo em bloco) e coloque a identificação do julgado (tribunal, processo, relator, datas) na linha imediatamente seguinte, dentro do mesmo <blockquote>, entre parênteses.
- CAPA: mantenha respiro amplo entre endereçamento, qualificação do reclamante, "RECLAMAÇÃO TRABALHISTA", rito e qualificação de cada reclamada — cada um em seu próprio <p>, nunca amontoados.
- Toda citação de doutrina, transcrição de artigo de lei ou ementa/aresto de jurisprudência deve ficar em um <blockquote> próprio, isolada do texto principal (o código aplica o recuo e o espaçamento).
- Siga a ESTRUTURA e o TEXTO-PADRÃO do modelo do escritório reproduzido em texto abaixo (mesma ordem e mesmos tópicos fixos), preenchendo com os dados REAIS do caso. Onde faltar um dado, deixe um marcador claro entre colchetes, ex.: [SALÁRIO].
- Ajuste ou REMOVA os tópicos que não se aplicam ao caso; mantenha os tópicos fixos.
- Todo dado variável que você preencher com informações do caso atual deve ficar envolvido por <mark class="ai-filled-field" data-ai-field="nome_do_campo">valor</mark>. Nunca marque o texto jurídico padrão.

=== MODELO PADRÃO DO ESCRITÓRIO (texto — siga a estrutura e o texto-padrão) ===
${esqueletoDoModelo(modeloHtml)}
=== FIM DO MODELO PADRÃO ===
${blocoReferencias}
=== ENTREVISTA / CASO ATUAL ===
${texto || '(ver documentos anexados)'}

Atributos detectados: função=${attrs?.funcao || '-'}, modalidade=${attrs?.tipo_dispensa || '-'}, rito=${attrs?.rito || '-'}, tomadora=${attrs?.tem_tomadora ? 'sim' : 'não'}.${
    municipios.length
      ? `\nCompetência calculada por código: ${municipios
          .map((m) => `${m} → ${regiaoTrtPorMunicipio(m) || 'região a confirmar'}`)
          .join('; ')}. USE esta região; não a recalcule.`
      : ''
  }
=== FIM DA ENTREVISTA ===${blocoReceita(dadosReceita)}${blocoCeps(dadosCep)}${blocoDatajud(dadosDatajud)}${blocoCct(dadosCct)}${blocoCalculos(calculos)}

FORMATO DE SAÍDA: retorne APENAS o HTML simples do corpo da petição (sem <html>, <head>, <body>, sem <style> e sem atributos style). NÃO acrescente avisos, notas ou observações ao final. NÃO escreva a data do fecho, "Pede deferimento", "Dá-se à causa" nem a assinatura — encerre no último requerimento final e, na sequência, na mesma resposta, inclua a linha única do CONTRATO DE SAÍDA (<!--PEDIDOS_VALORES:[...]-->) exatamente como especificado no início deste prompt.`;
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

// Extração DETERMINÍSTICA (sem chamada de IA) do rol de valores que a própria
// IA já embute na MESMA resposta, como última linha, no formato combinado no
// CONTRATO DE SAÍDA do prompt principal: <!--PEDIDOS_VALORES:[v1,v2,...]-->.
// Isso evita por completo uma segunda chamada de IA para "reler" o que a
// primeira acabou de escrever (mais lento e mais frágil) — só fazemos um
// parse de array numérico, e removemos o comentário do HTML final.
const PEDIDOS_VALORES_RE = /<!--\s*PEDIDOS_VALORES\s*:\s*(\[[^\]]*\])\s*-->/i;

export function extrairValoresPedidos(html) {
  const m = PEDIDOS_VALORES_RE.exec(html || '');
  if (!m) return { valores: [], htmlSemComentario: html || '' };
  let valores = [];
  try {
    const arr = JSON.parse(m[1]);
    if (Array.isArray(arr)) valores = arr.map(Number).filter((n) => Number.isFinite(n));
  } catch (e) {
    /* array malformado — valores fica vazio, o piso de segurança assume depois */
  }
  return { valores, htmlSemComentario: html.replace(PEDIDOS_VALORES_RE, '').trim() };
}

export async function gerarPecaPadrao({ texto, fileUrls, attrs, modeloPadrao, onTool }) {
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
      ? withRuntimeCache('extracao-caso', runtimeCacheKey({ texto, fileUrls: fileUrls || [] }), () => extrairCasoDeTexto(texto, fileUrls), {
          onHit: () => notify('Reutilizando análise estruturada da entrevista em cache...'),
        }).catch(() => ({}))
      : Promise.resolve({}),
  ]);

  // Convenção coletiva (CCT) vigente na data do fato — cláusulas reais como contexto para a IA.
  let dadosCct = null;
  if (config.cct_ativo) {
    // Base territorial: usa o município/UF verificado por CEP (local de prestação).
    const localCep = (dadosCep || []).find((d) => !d.erro && d.municipio) || {};
    notify(
      `Consultando a CCT vigente (categoria/vigência${localCep.municipio ? ` / base territorial: ${localCep.municipio}/${localCep.uf}` : ''})...`
    );
    dadosCct = await enriquecerCct(caso, attrs, config, {
      municipio: localCep.municipio,
      uf: localCep.uf,
    }).catch(() => null);
    if (dadosCct?.perguntas?.length) notify(`Temas buscados na base de CCT: ${dadosCct.perguntas.join('; ')}`);
    if (dadosCct?.meta?.titulo) notify(`CCT aplicável: ${dadosCct.meta.titulo}`);
  }

  // Cálculo 100% determinístico (a IA não faz aritmética).
  const calculos = calcularVerbasCaso(caso || {});

  // Seleciona os modelos de referência mais semelhantes (matching determinístico,
  // por atributos estruturados) — até 3, desde que tenham pontuação > 0. Usar mais
  // de um evita descartar o 2º/3º colocado quando a pontuação está próxima do 1º;
  // o orçamento de caracteres do diferencial é dividido entre os selecionados para
  // não inflar demais o prompt.
  let modeloSemelhante = null;
  let modelosSemelhantes = [];
  let referencias = [];
  try {
    const modelos = await listarModelosAtivos();
    const ranking = rankearModelos(modelos, attrs || {}).filter((r) => r.score > 0).slice(0, 3);
    modelosSemelhantes = ranking.map((r) => r.modelo);
    modeloSemelhante = modelosSemelhantes[0] || null;
    if (modelosSemelhantes.length) {
      const orcamentoPorModelo = Math.floor(4500 / modelosSemelhantes.length);
      referencias = modelosSemelhantes.map((m) => ({
        titulo: m.titulo || '',
        diferencial: (m.diferencial || m.conteudo || m.resumo || '').slice(0, orcamentoPorModelo),
      }));
      notify(`Referências mais semelhantes: ${modelosSemelhantes.map((m) => m.titulo).filter(Boolean).join(' • ')}`);
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
      referencias,
      dadosReceita,
      dadosCep,
      dadosDatajud,
      dadosCct,
    }),
    model: 'claude_sonnet_4_6',
  };
  const urls = [...(fileUrls || [])];
  if (urls.length) req.file_urls = urls;
  const resultado = await withRuntimeCache(
    'geracao-minuta',
    runtimeCacheKey({ prompt: req.prompt, fileUrls: urls }),
    () =>
      traceAiCall('Geração da minuta', req, () =>
        invokeLLMComRetry(req, {
          tentativas: 2,
          timeoutMs: 600000,
          onRetry: (n) => notify(`Instabilidade no serviço de IA — tentando novamente (${n}ª retentativa)...`),
        })
      ),
    { onHit: () => notify('Reutilizando geração idêntica em cache...') }
  );

  // Sanidade mínima: se a IA devolveu um documento anormalmente curto ou sem
  // o rol de pedidos, é sinal de falha na geração — melhor falhar alto do
  // que aceitar silenciosamente uma peça incompleta (já aconteceu em produção).
  const htmlBrutoIA = typeof resultado === 'string' ? resultado : resultado?.html || '';
  const htmlSemPedidos = limparHtmlIA(htmlBrutoIA);
  if (htmlSemPedidos.length < 3000 || !/DOS PEDIDOS/i.test(htmlSemPedidos)) {
    throw new Error('A minuta gerada pela IA veio incompleta (texto muito curto ou sem o rol de pedidos). Gere novamente.');
  }

  // Valor da causa: NUNCA confiamos no texto livre da IA para essa soma nem
  // para o "por extenso" — a própria IA já embute o array de valores na MESMA
  // resposta (CONTRATO DE SAÍDA: <!--PEDIDOS_VALORES:[...]-->), sem precisar de
  // uma segunda chamada de IA para reler o que ela mesma acabou de escrever.
  // Só fazemos um parse determinístico e removemos o comentário do HTML final.
  const { valores, htmlSemComentario } = extrairValoresPedidos(htmlSemPedidos);
  const htmlLimpo = htmlSemComentario;
  let valorCausa = null;
  if (valores.length) {
    valorCausa = round2(valores.reduce((soma, v) => soma + v, 0));
    notify(`Valor da causa calculado por código (soma de ${valores.length} itens do rol de pedidos): R$ ${valorCausa.toFixed(2).replace('.', ',')}`);
  } else {
    notify('Não foi possível ler o rol de valores dos pedidos na resposta da IA — confira o valor da causa manualmente.');
  }
  const pedidos = valores;

  // Piso de segurança: NUNCA deixe a petição sair sem nenhum valor da causa.
  // Se a extração do rol de pedidos falhou (valorCausa ainda null), usamos a
  // soma das verbas 100% determinísticas (mathUtils.js) como piso mínimo —
  // sempre disponível, sem chamada extra de IA. É parcial (não inclui horas
  // extras, intervalo, desvio de função etc., que são estimados pela IA), por
  // isso avisamos explicitamente para conferência manual — mas a frase "Dá-se
  // à causa" nunca mais fica ausente da peça.
  if (valorCausa == null) {
    const somaDeterministica = round2((calculos || []).reduce((soma, c) => soma + (Number(c?.valor) || 0), 0));
    if (somaDeterministica > 0) {
      valorCausa = somaDeterministica;
      notify(
        `Usando apenas a soma das verbas determinísticas como valor da causa (R$ ${valorCausa.toFixed(2).replace('.', ',')}) — NÃO inclui horas extras, intervalo, desvio de função e demais itens estimados pela IA. Confira e ajuste manualmente antes de protocolar.`
      );
    }
  }
  const htmlSemZerados = removerPedidosZerados(htmlLimpo);
  const htmlBruto = aplicarFechoDeterministico(htmlSemZerados, { valorCausa });

  return {
    html: aplicarFormatacaoPadrao(htmlBruto),
    valorCausa,
    pedidos,
    dadosReceita,
    dadosCep,
    dadosDatajud,
    dadosCct,
    calculos,
    caso,
    modeloSemelhante: modeloSemelhante ? { titulo: modeloSemelhante.titulo } : null,
    modelosSemelhantes: modelosSemelhantes.map((m) => ({ titulo: m.titulo })),
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

export async function verificarCoerencia({ texto, caso, html, dadosReceita, dadosCep }) {
  const prompt = `Você é um auditor jurídico trabalhista. Verifique a MINUTA gerada quanto à COERÊNCIA factual e jurídica com o caso. NÃO reescreva a peça — apenas aponte problemas.

NÃO SÃO PROBLEMAS (padrão de prática do escritório — NÃO flagre como "sem suporte fático", mesmo sem menção explícita na entrevista):
- Para VIGILANTE ARMADO: adicional de periculosidade nas horas extras (Súmula 132 TST — presunção legal do art. 193 CLT, não depende de confirmação do cliente); minutos que antecedem e sucedem a jornada (preleção/rendição); 10 minutos de descanso por hora (cláusula da CCT de vigilância).
- Sempre que houver FOLGAS TRABALHADAS (FTs) relatadas: vale-transporte e auxílio-alimentação não concedidos nessas folgas, com valores-padrão (R$ 10,00/dia; valor da CCT) mesmo sem confirmação explícita do uso de transporte/alimentação.
- Razão social/CEP/endereço das reclamadas que divergem do texto da entrevista MAS coincidem com os dados oficiais da Receita Federal/ViaCEP fornecidos abaixo — isso é CORRETO (o sistema sempre prioriza o dado oficial verificado sobre o relato informal do cliente). Só marque como problema se a peça divergir TAMBÉM do dado oficial (nem do relato, nem do oficial).
- A seção "DAS VERBAS RESCISÓRIAS" é NARRATIVA (recapitula em prosa o que já será formalmente pedido) — NÃO conte os valores citados ali como uma segunda soma. Só aponte duplicidade se o MESMO item aparecer DUAS VEZES no rol formal "DOS PEDIDOS".

Continue flagrando normalmente: adicional noturno SEM jornada que realmente cruze 22h-5h (isso depende do horário relatado, não é presunção da categoria); assiduidade sem prova de prêmio prometido/suprimido.

Checagens obrigatórias:
- Tese/pedido SEM suporte no relato, RESSALVADAS as exceções de padrão de categoria listadas acima (ex.: adicional noturno sem jornada noturna real; horas extras sem alegação de sobrejornada).
- COMPETÊNCIA/TRT errado para o município de prestação (Grande São Paulo/Baixada/Litoral = TRT 2ª Região; interior/Campinas = TRT 15ª Região). Divergência é BLOQUEANTE.
- Tópico ou quadro sobre ESCALA DIFERENTE da relatada (ex.: 4x2 quando o caso é 12x36) — BLOQUEANTE.
- DESVIO e ACÚMULO de função pedidos cumulativamente sobre os mesmos fatos — BLOQUEANTE.
- Percentual de HONORÁRIOS divergente entre o tópico, os pedidos e o fecho, ou citação da Súmula 425 do TST para fundamentar honorários (ela trata de jus postulandi — a base correta é o art. 791-A da CLT) — BLOQUEANTE.
- Data do fecho anterior à data de desligamento do empregado — BLOQUEANTE.
- Valores estimados redondos/genéricos sem base de cálculo, ou valor da causa desproporcional ao salário e ao período contratual.
- Data do fecho ainda como "[data]".
- Verba pedida em DUPLICIDADE (ex.: aviso prévio indenizado em item isolado e novamente no detalhamento das verbas rescisórias, inflando o valor da causa) — BLOQUEANTE.
- E-mail do escritório usado na qualificação do reclamante em lugar do e-mail pessoal dele — BLOQUEANTE.
- Endereço residencial do reclamante indicado como local de prestação de serviços no tópico da competência — BLOQUEANTE.
- Endereço das reclamadas com grafia divergente da entrevista/dados oficiais (inclusive quilometragem).
- Frases soltas, cortadas ou fragmentadas no tópico de dano moral.
- Marcadores entre colchetes [ ] ainda pendentes (dados que faltam preencher).
- Modalidade de rescisão incompatível com os pedidos.
- Valor da causa acima de R$ 400.000,00, ou diferente da soma dos itens do rol de pedidos.
- Enquadramento funcional errado: vigilante em prevenção de perdas/conferência de cargas deve gerar DESVIO de função (50%/mês); vigilante conduzindo veículo, GRATIFICAÇÃO de 10%; porteiro em rondas, ACÚMULO de 20% — cumular esses pedidos sobre os mesmos fatos é BLOQUEANTE.
- Dano moral em valor diferente de 10x o último salário, ou sem a narrativa concreta dos fatos do caso.
- Pedido com "[VALOR A APURAR]", "R$ 0,00" ou colchete de rascunho no rol de pedidos — BLOQUEANTE.
- Menção a aviso prévio "trabalhado" ou à redução de 2 horas diárias quando a dispensa foi sem justa causa e imediata (deve ser aviso prévio INDENIZADO) — BLOQUEANTE.
- Ausência de tópico obrigatório (ex.: responsabilidade subsidiária quando há tomadora).

Classifique cada alerta: BLOQUEANTE (erro grave), ATENCAO (revisar) ou INFO. Defina "status": "bloqueado" se houver BLOQUEANTE; "revisar" se houver ATENCAO; senão "aprovado".

DADOS DO CASO (estruturado): ${JSON.stringify(caso || {})}
DADOS OFICIAIS JÁ VERIFICADOS (Receita Federal/ViaCEP — use para julgar se uma divergência do relato é uma correção legítima, não um erro): ${JSON.stringify(dadosReceita || [])} ${JSON.stringify(dadosCep || [])}
RELATO/ENTREVISTA: """${texto || ''}"""
MINUTA GERADA (HTML): """${html || ''}"""

Responda APENAS com o objeto JSON.`;
  const request = {
    prompt,
    model: 'claude_sonnet_4_6',
    response_json_schema: COERENCIA_SCHEMA,
  };
  const resultado = await withRuntimeCache('auditoria-coerencia', runtimeCacheKey(prompt), () =>
    traceAiCall('Auditoria de coerência', request, () => invokeLLMComRetry(request))
  );
  // O retorno pode vir embrulhado em { response: {...} } — desembrulha antes
  // de o chamador ler "status" e "alertas" (senão a auditoria fica sempre vazia).
  return resultado?.response ?? resultado;
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