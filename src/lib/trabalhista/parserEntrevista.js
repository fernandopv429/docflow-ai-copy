import { base44 } from '@/api/base44Client';
import { traceAiCall } from '@/lib/sessionTrace';

// Agente extrator: converte o texto livre da entrevista diretamente nos
// campos usados pelo template (dadosTemplate.js), usando um modelo rápido/barato.
// Além dos dados estruturados, extrai os POUCOS trechos livres do caso concreto
// (fatos do dano moral, fatos do capítulo de rescisão) e as flags das teses.
const CASO_SCHEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string', description: 'Ex.: "Nome do reclamante × 1ª reclamada"' },

    // Reclamante
    recl_nome: { type: 'string' },
    recl_nacionalidade: { type: 'string' },
    recl_estado_civil: { type: 'string' },
    recl_cpf: { type: 'string', description: 'Somente números' },
    recl_rg: { type: 'string' },
    recl_pis: { type: 'string' },
    recl_ctps: { type: 'string' },
    recl_serie: { type: 'string' },
    recl_nascimento: { type: 'string', description: 'Formato YYYY-MM-DD' },
    recl_filiacao: { type: 'string', description: 'Nome do pai e/ou da mãe' },
    recl_endereco: { type: 'string' },

    // Reclamadas
    recl1_nome: { type: 'string', description: 'Razão social da 1ª reclamada (empregadora)' },
    recl1_cnpj: { type: 'string', description: 'Somente números' },
    recl1_logradouro: { type: 'string' },
    recl2_nome: { type: 'string', description: '2ª reclamada / tomadora de serviços, se houver' },
    recl2_cnpj: { type: 'string' },
    recl3_nome: { type: 'string' },
    recl3_cnpj: { type: 'string' },

    // Contrato
    data_admissao: { type: 'string', description: 'Formato YYYY-MM-DD' },
    data_rescisao: { type: 'string', description: 'Formato YYYY-MM-DD' },
    funcao: { type: 'string' },
    salario: { type: 'number' },
    jornada_horario: { type: 'string', description: 'Ex.: 12x36 das 19h às 7h' },
    jornada_extrapola: { type: 'boolean', description: 'true se houver sobrejornada/horas extras' },
    intervalo_gozado: { type: 'boolean', description: 'false se o intervalo intrajornada não era usufruído' },
    sindicato: { type: 'string', description: 'Sindicato profissional da categoria' },
    cct: { type: 'string', description: 'Convenção coletiva aplicável, se citada' },
    tipo_dispensa: {
      type: 'string',
      enum: ['sem_justa_causa', 'rescisao_indireta', 'nulidade_pedido_demissao', 'reversao_justa_causa', 'acordo'],
    },
    comarca_uf: { type: 'string', description: 'UF com 2 letras (ex.: SP)' },
    val_ft: { type: 'number', description: 'Quantidade de folgas trabalhadas' },
    ft_qtd_media: { type: 'number' },

    // Flags das teses (true APENAS com suporte no relato)
    tem_desvio: { type: 'boolean' },
    tem_acumulo: { type: 'boolean' },
    tem_intervalo_suprimido: { type: 'boolean', description: 'Intervalo intrajornada suprimido/reduzido (art. 71 CLT)' },
    tem_adic_noturno: { type: 'boolean' },
    tem_dsr: { type: 'boolean', description: 'Diferenças de DSR' },
    tem_minutos_residuais: { type: 'boolean', description: 'Minutos que antecedem/sucedem a jornada' },
    tem_dez_min_cct: { type: 'boolean', description: 'Cláusula de 10 minutos de descanso (CCT)' },
    tem_insalubridade: { type: 'boolean' },
    tem_periculosidade: { type: 'boolean' },
    tem_integracao_por_fora: { type: 'boolean', description: 'Pagamento "por fora" a integrar à remuneração' },
    tem_vale_transporte: { type: 'boolean', description: 'Ausência de vale-transporte nas folgas' },
    tem_auxilio_alimentacao: { type: 'boolean', description: 'Ausência de auxílio-alimentação nas folgas' },
    tem_estabilidade: { type: 'boolean', description: 'Estabilidade por doença/acidente' },
    tem_pensao: { type: 'boolean', description: 'Pensão vitalícia' },
    tem_assiduidade: { type: 'boolean' },
    tem_dano_moral: { type: 'boolean' },

    // Textos livres do caso concreto
    dano_fatos: { type: 'string', description: 'Fatos que configuram o dano moral, redigidos em 2-4 frases' },
    dano_supervisor: { type: 'string', description: 'Nome/conduta do supervisor, se relatado' },
    coacao_fatos: { type: 'string', description: 'Fatos da coação/rescisão indireta/reversão, redigidos em 2-4 frases' },
  },
};

export async function extrairCasoDeTexto(texto, fileUrls) {
  const request = {
    prompt: `Você é um extrator de dados de entrevistas trabalhistas. Leia o texto livre abaixo (resumo da entrevista feito pelo advogado) e preencha os campos do caso.

TEXTO:
"""
${texto}
"""

Regras:
- Extraia SOMENTE o que estiver explícito ou claramente inferível no texto. NÃO invente dados.
- Omita campos sem informação (não retorne string vazia nem null).
- Datas em YYYY-MM-DD (interprete formatos brasileiros como 22/01/26 → 2026-01-22).
- CPF/CNPJ somente números. Salário como número (ex.: 2500.00).
- tipo_dispensa: "demissão forçada", coação ou perseguição para pedir demissão → nulidade_pedido_demissao; falta grave do empregador → rescisao_indireta; justa causa contestada → reversao_justa_causa.
- Booleans (tem_*, jornada_extrapola, intervalo_gozado): defina apenas com suporte no relato.
- dano_fatos e coacao_fatos: redija de forma objetiva (2-4 frases) SOMENTE se houver fatos no relato; caso contrário, omita.

Responda APENAS com o objeto JSON.`,
    model: 'gemini_3_flash',
    response_json_schema: CASO_SCHEMA,
  };
  if (fileUrls?.length) request.file_urls = fileUrls;
  const dados = await traceAiCall('Extração estruturada do caso', request, () =>
    base44.integrations.Core.InvokeLLM(request)
  );

  // Remove valores vazios para não sobrescrever campos com lixo
  const limpo = {};
  for (const [k, v] of Object.entries(dados || {})) {
    if (v === null || v === undefined || v === '') continue;
    limpo[k] = v;
  }
  return limpo;
}
