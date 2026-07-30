import { base44 } from '@/api/base44Client';
import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';
import { traceAiCall } from '@/lib/sessionTrace';
import { extrairCnpjs, extrairCeps, enriquecerCnpjs, enriquecerCeps } from './consultas';

// ============================================================
// Conversa (chat) da entrevista: coleta dados incrementalmente,
// infere atributos por regex (determinístico) e decide quando
// a peça pode ser gerada.
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
  const cnpjsParaConsultar = [
    ...new Set([
      ...(atributos.cnpjs || []),
      ...inferido.cepsIncompletosComCnpj.map((item) => item.cnpj),
    ].map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 14)),
  ];
  if (cnpjsParaConsultar.length) {
    const dadosOficiais = await enriquecerCnpjs(cnpjsParaConsultar);
    const confirmados = [];
    for (const dado of dadosOficiais) {
      if (dado.erro) continue;
      const cepOficial = (dado.cep || '').replace(/\D/g, '');
      if (cepOficial.length === 8) {
        atributos.ceps = [...new Set([...(atributos.ceps || []), cepOficial])];
      }
      confirmados.push(`${dado.razao_social} (${dado.cnpj})${cepOficial.length === 8 ? ` — CEP ${dado.cep}` : ''}`);
    }
    if (confirmados.length) {
      correcoesAutomaticas.push(`CNPJ(s) confirmado(s) na Receita Federal: ${confirmados.join('; ')}`);
    }
    for (const item of inferido.cepsIncompletosComCnpj) {
      const cnpjDigits = item.cnpj.replace(/\D/g, '');
      const oficial = dadosOficiais.find((dado) => (dado.cnpj || '').replace(/\D/g, '') === cnpjDigits);
      if (oficial && !oficial.erro) {
        inferido.pendencias = inferido.pendencias.filter(
          (pendencia) => !pendencia.startsWith(`CEP "${item.cepInformado}"`)
        );
      }
    }
  }

  // Consulta de CEP (ViaCEP/BrasilAPI) — completa logradouro, bairro, município e UF,
  // fundamentando a competência territorial (art. 651 da CLT) já durante a entrevista.
  const cepsParaConsultar = [
    ...new Set((atributos.ceps || []).map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 8)),
  ];
  if (cepsParaConsultar.length) {
    const dadosCep = await enriquecerCeps(cepsParaConsultar);
    const cepsCompletos = [];
    for (const dado of dadosCep) {
      if (dado.erro) continue;
      const local = [dado.logradouro, dado.bairro].filter(Boolean).join(', ');
      const cidade = [dado.municipio, dado.uf].filter(Boolean).join('/');
      atributos.local_prestacao = atributos.local_prestacao || (local ? `${local}, ${cidade}` : cidade);
      atributos.comarca_uf = atributos.comarca_uf || dado.uf;
      cepsCompletos.push(`CEP ${dado.cep}${dado.municipio ? ` — ${cidade}` : ''}`);
    }
    if (cepsCompletos.length) {
      correcoesAutomaticas.push(`Endereço/local de prestação completado(s) via CEP: ${cepsCompletos.join('; ')}`);
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