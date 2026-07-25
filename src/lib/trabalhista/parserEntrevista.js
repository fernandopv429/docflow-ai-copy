import { base44 } from '@/api/base44Client';
import { traceAiCall } from '@/lib/sessionTrace';

// Agente extrator: converte o texto livre da entrevista diretamente nos
// campos da entidade CasoTrabalhista, usando um modelo rápido/barato.
const CASO_SCHEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string', description: 'Ex.: "Nome do reclamante × 1ª reclamada"' },
    recl_nome: { type: 'string' },
    recl_cpf: { type: 'string', description: 'Somente números' },
    recl_rg: { type: 'string' },
    recl_pis: { type: 'string' },
    recl_ctps: { type: 'string' },
    recl_endereco: { type: 'string' },
    recl1_nome: { type: 'string', description: 'Razão social da 1ª reclamada (empregadora)' },
    recl1_cnpj: { type: 'string', description: 'Somente números' },
    recl1_logradouro: { type: 'string' },
    recl2_nome: { type: 'string', description: '2ª reclamada / tomadora de serviços, se houver' },
    recl2_cnpj: { type: 'string' },
    recl3_nome: { type: 'string' },
    recl3_cnpj: { type: 'string' },
    data_admissao: { type: 'string', description: 'Formato YYYY-MM-DD' },
    data_rescisao: { type: 'string', description: 'Formato YYYY-MM-DD' },
    funcao: { type: 'string' },
    salario: { type: 'number' },
    jornada_horario: { type: 'string', description: 'Ex.: 12x36 das 19h às 7h' },
    tipo_dispensa: {
      type: 'string',
      enum: ['sem_justa_causa', 'rescisao_indireta', 'nulidade_pedido_demissao', 'reversao_justa_causa', 'acordo'],
    },
    comarca_uf: { type: 'string', description: 'UF com 2 letras (ex.: SP)' },
    val_ft: { type: 'number', description: 'Quantidade de folgas trabalhadas' },
    ft_qtd_media: { type: 'number' },
    tem_desvio: { type: 'boolean' },
    tem_acumulo: { type: 'boolean' },
    tem_insalubridade: { type: 'boolean' },
    tem_periculosidade: { type: 'boolean' },
    tem_adic_noturno: { type: 'boolean' },
    dano_sem_estrutura: { type: 'boolean' },
    dano_fatos: { type: 'string', description: 'Fatos que configuram dano moral' },
    dano_supervisor: { type: 'string', description: 'Nome/conduta do supervisor, se relatado' },
  },
};

export async function extrairCasoDeTexto(texto) {
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
- Booleans (tem_*): true apenas com suporte no relato.

Responda APENAS com o objeto JSON.`,
    model: 'gemini_3_flash',
    response_json_schema: CASO_SCHEMA,
  };
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