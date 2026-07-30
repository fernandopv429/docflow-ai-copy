import { base44 } from '@/api/base44Client';
import { traceAiCall } from '@/lib/sessionTrace';

// Agente extrator: converte o texto livre da entrevista nos campos usados pelo
// MODELO-MESTRE (via dadosTemplate.js). Extrai dados estruturados, os poucos
// trechos livres do caso (fatos do dano moral) e as flags das teses.
const CASO_SCHEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string', description: 'Ex.: "Nome do reclamante × 1ª reclamada"' },

    // Reclamante
    recl_nome: { type: 'string' },
    recl_genero: { type: 'string', enum: ['M', 'F'], description: 'Gênero do reclamante (M/F) para concordância' },
    recl_nacionalidade: { type: 'string' },
    recl_estado_civil: { type: 'string' },
    recl_cpf: { type: 'string', description: 'Somente números' },
    recl_rg: { type: 'string' },
    recl_pis: { type: 'string' },
    recl_ctps: { type: 'string' },
    recl_serie: { type: 'string' },
    recl_nascimento: { type: 'string', description: 'Formato YYYY-MM-DD' },
    recl_filiacao: { type: 'string', description: 'Nome da mãe e do pai' },
    recl_endereco: { type: 'string' },

    // Reclamadas
    recl1_nome: { type: 'string', description: 'Razão social da 1ª reclamada (empregadora)' },
    recl1_cnpj: { type: 'string', description: 'Somente números' },
    recl1_logradouro: { type: 'string' },
    recl2_nome: { type: 'string', description: '2ª reclamada / tomadora de serviços, se houver' },
    recl2_cnpj: { type: 'string' },
    local_prestacao: { type: 'string', description: 'Endereço do local onde os serviços foram prestados (define a competência)' },
    comarca_uf: { type: 'string', description: 'UF com 2 letras (ex.: SP)' },

    // Contrato
    data_admissao: { type: 'string', description: 'Formato YYYY-MM-DD' },
    data_rescisao: { type: 'string', description: 'Formato YYYY-MM-DD' },
    funcao: { type: 'string' },
    salario: { type: 'number' },
    maior_remuneracao: { type: 'number', description: 'Maior remuneração na função (base do dano moral); se ausente, usa o salário' },
    tipo_dispensa: {
      type: 'string',
      enum: ['sem_justa_causa', 'rescisao_indireta', 'nulidade_pedido_demissao', 'reversao_justa_causa', 'acordo'],
    },

    // Jornada
    jornada_horario: { type: 'string', description: 'Horários. Ex.: das 19h às 7h' },
    escala: { type: 'string', description: 'Escala. Ex.: 12x36, 4x2, 5x2, 6x1' },
    intervalo_usufruido: { type: 'string', description: 'Intervalo efetivo. Ex.: 10 a 15 minutos' },
    prorrogacao_jornada: { type: 'string', description: 'Extensão habitual. Ex.: 30 min a 1h' },
    val_ft: { type: 'number', description: 'Valor pago por CADA folga trabalhada (R$)' },
    val_conducao: { type: 'number', description: 'Valor de UMA condução (R$), p/ vale-transporte nas folgas' },
    ft_qtd_media: { type: 'number', description: 'Média de folgas/feriados trabalhados por mês' },

    // Teses — dados de apoio
    acumulo_atividades: { type: 'string', description: 'Tarefas extras acumuladas (ex.: rondas, recepção, limpeza)' },
    desvio_atividades: { type: 'string', description: 'Atividades de função superior/diversa exercidas (desvio de função)' },
    salarios_aberto: { type: 'string', description: 'Meses de salário não pagos (ex.: julho e dezembro de 2024)' },
    assiduidade_prometido: { type: 'number', description: 'Bônus de assiduidade prometido (R$)' },
    assiduidade_pago: { type: 'number', description: 'Bônus de assiduidade efetivamente pago (R$)' },
    assiduidade_diferenca: { type: 'number', description: 'Diferença mensal da assiduidade (R$)' },
    doenca_descricao: { type: 'string', description: 'Doença/lesão ocupacional (ex.: hérnia de disco)' },
    valor_por_fora: { type: 'number', description: 'Valor médio pago por fora (R$)' },
    valor_aux_alimentacao: { type: 'number', description: 'Valor diário do auxílio-alimentação da CCT (R$)' },
    cct_ano: { type: 'string', description: 'Ano da CCT aplicável. Ex.: 2025' },
    cct_clausulas: { type: 'string', description: 'Cláusulas específicas citadas' },
    cct_clausula_multa: { type: 'string', description: 'Cláusula da multa convencional' },
    periodo_ferias_prop: { type: 'string', description: 'Período das férias proporcionais, se citado' },
    periodo_13: { type: 'string', description: 'Período do 13º proporcional, se citado' },
    periodo_ferias_vencidas: { type: 'string', description: 'Período das férias vencidas, se houver' },

    // Flags das teses (true APENAS com suporte no relato)
    tem_acumulo: { type: 'boolean' },
    tem_desvio: { type: 'boolean', description: 'Exercia função superior/diversa (desvio de função)' },
    tem_gratificacao: { type: 'boolean', description: 'Vigilante condutor sem gratificação de 10% (cláusula 3ª)' },
    tem_dez_min_cct: { type: 'boolean', description: 'Vigilância: não concessão dos 10 min de descanso (cláusula 33ª)' },
    tem_salarios_aberto: { type: 'boolean', description: 'Há salários em aberto/não pagos' },
    tem_adic_noturno: { type: 'boolean', description: 'Houve labor em horário noturno' },
    tem_integracao_por_fora: { type: 'boolean', description: 'Pagamento "por fora" (dinheiro/PIX)' },
    tem_periculosidade: { type: 'boolean' },
    tem_assiduidade: { type: 'boolean', description: 'Bônus de assiduidade pago a menor' },
    tem_vale_transporte: { type: 'boolean', description: 'Ausência de VT nas folgas' },
    tem_auxilio_alimentacao: { type: 'boolean', description: 'Ausência de auxílio-alimentação nas folgas' },
    tem_doenca: { type: 'boolean', description: 'Doença ocupacional decorrente do trabalho' },
    tem_estabilidade: { type: 'boolean', description: 'Estabilidade provisória (acompanha doença)' },
    tem_pensao: { type: 'boolean', description: 'Perda/redução da capacidade laborativa' },
    tem_ft: { type: 'boolean', description: 'Folgas/feriados trabalhados' },
    tem_ferias_vencidas: { type: 'boolean' },
    tem_dano_moral: { type: 'boolean' },

    // Textos livres do caso concreto
    dano_fatos: { type: 'string', description: 'Fato concreto do dano moral, redigido em 2-4 frases (nome do supervisor, tipo de perseguição/humilhação)' },

    // Fatos narrados (auditoria cruzada com os capítulos da minuta)
    fatos_narrados: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lista TODA irregularidade/fato específico mencionado na entrevista, um por item (ex.: "desconto integral indevido de empréstimo consignado na rescisão", "folgas trabalhadas pagas informalmente via PIX", "desvio para Prevenção de Perdas"). Nenhum pode ser omitido — serve para a auditoria cruzar com os capítulos da minuta.',
    },
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
- CPF/CNPJ somente números. Valores monetários como número (ex.: 2500.00).
- tipo_dispensa: "demissão forçada", coação ou perseguição para pedir demissão → nulidade_pedido_demissao; falta grave do empregador → rescisao_indireta; justa causa contestada → reversao_justa_causa.
- Booleans (tem_*): defina true apenas com suporte no relato.
- recl_genero: 'M' ou 'F', inferido do nome/relato (para concordância de gênero na peça).
- maior_remuneracao: preencha só se citada uma remuneração maior que o salário (base do dano moral); senão omita.
- val_ft = valor de CADA folga trabalhada (se informado em faixa, ex.: "180 a 200", use a média: 190); val_conducao = valor de UMA condução; valor_aux_alimentacao = valor diário; ft_qtd_media = folgas por mês (se faixa, use a média).
- recl_serie: extraia o número de série da CTPS (campo "serie" ou "Série nº" na entrevista).
- recl_ctps: somente o número da CTPS (sem a série).
- dano_fatos: redija de forma objetiva (2-4 frases) SOMENTE se houver fatos no relato; caso contrário, omita.
- fatos_narrados: liste TODA irregularidade/fato específico mencionado na entrevista, um por item, por mais simples que pareça (descontos indevidos, folgas pagas por fora, desvio/acúmulo, intervalo reduzido, minutos antecedentes/sucedentes, falta de VT/auxílio nas folgas, doença, etc.). Nenhum fato narrado pode ser omitido — a auditoria usa esta lista para garantir que cada fato vire capítulo na minuta.

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