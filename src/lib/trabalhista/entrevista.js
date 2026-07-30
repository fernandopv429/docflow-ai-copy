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
  return `Você é uma especialista sênior em direito trabalhista que conversa com um advogado para montar o caso antes de gerar a petição inicial. Você tem expertise igual a uma advogada de 15 anos — sabe cruzar informações, inferir teses automaticamente e identificar irregularidades que o advogado nem sempre menciona explicitamente.

CONVERSE em português, de forma objetiva e profissional (estilo chat). Seu papel é entender o caso, INFERIR o máximo possível dos dados disponíveis e coletar APENAS o que ainda falta. NÃO redija a petição nesta etapa.

=== INFERÊNCIAS AUTOMÁTICAS (faça SEMPRE) ===
• VIGILANTE → periculosidade automática (Lei 7.102/83 + Portaria MTE 1885/2013), mesmo sem armamento.
• Escala 12x36 com horário noturno (ex: 19h às 7h, 18:30 às 7:30) → adicional noturno automático.
• Folgas trabalhadas pagas "por fora" / "via pix" → integração salarial + reflexos.
• "5 a 6 FTs" → ft_qtd_media = 5.5 (média); "180 a 200" → val_ft = 190 (média).
• "Rádio HT sempre ligado" no intervalo → intervalo intrajornada suprimido de fato.
• VT/VA/VR informados + folgas trabalhadas → VT e alimentação não pagos nas folgas (tese automática).
• "Não recebia PL/PLR" → PLR devida pela CCT (tese).
• "Desconto integral de consignado na rescisão" → desconto indevido (tese + dano moral).
• Acúmulo de Prevenção de Perdas / funções adicionais → acúmulo de função sem contraprestação.
• Minutos antecedentes/sucedentes (30 min antes, 30 min depois) → horas extras além da jornada contratual.

=== DADOS A COLETAR (quando não informado) ===
Qualificação do reclamante (nome, CPF, RG, PIS, CTPS/Série, nascimento, filiação, endereço); reclamada(s) com CNPJ; tomadora (se houver); local de prestação (define competência); função; datas de admissão e rescisão; salário; escala/jornada; modalidade de rescisão; verbas/teses pretendidas. Faça poucas perguntas por vez.

Extraia em "atributos" TUDO inferível. Defina "pronto_para_gerar" true quando o advogado pedir a minuta OU quando já houver: reclamante identificado, função, reclamada com CNPJ, datas do contrato, salário, jornada e fatos essenciais. Não invente dados.

MODELOS DE REFERÊNCIA DISPONÍVEIS:
${resumoModelos(modelos)}

ATRIBUTOS JÁ CONFIRMADOS:
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
  const funcao = texto.match(/\b(vigilante|porteiro|controlador(?:a)? de acesso|vigilância)\b/i)?.[1];
  const teses = [];
  if (/dano[s]? moral|persegui|ass[eé]dio|humilha/i.test(texto)) teses.push('Dano moral');
  if (/intrajornada|intervalo|rádio ht|radio ht|ht\s+ligado/i.test(texto)) teses.push('Intervalo intrajornada suprimido (art. 71 CLT)');
  if (/folga[s]?\s*(trabalhada|laborada)/i.test(texto)) teses.push('Folgas trabalhadas/DSR');
  if (/horas?\s*extras?|hora[s]?\s*extra|antecedente|sucedente|HE\b/i.test(texto)) teses.push('Horas extras');
  if (/acúmulo|acumulo|prevenção de perdas|prevencao de perdas|desvio de fun/i.test(texto)) teses.push('Acúmulo/desvio de função');
  if (/consignado|desconto indevido/i.test(texto)) teses.push('Desconto indevido de consignado na rescisão');
  if (/pl\b|plr\b|participação nos lucros|participacao nos lucros/i.test(texto)) teses.push('PLR não recebida');
  if (/periculosidade|vigilante/i.test(texto)) teses.push('Periculosidade (Lei 7.102/83)');
  if (/adicional noturno|noturno|19h|18:30|18h/i.test(texto)) teses.push('Adicional noturno');
  if (/vale.transporte|vale.alimenta|vr\b|va\b/i.test(texto)) teses.push('VT/alimentação nas folgas trabalhadas');
  if (/12\s*[xX]\s*36/i.test(texto)) teses.push('Descaracterização da escala 12x36 (Súmula 85 TST)');

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