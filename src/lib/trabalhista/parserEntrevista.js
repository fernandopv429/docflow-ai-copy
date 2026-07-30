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
    tem_vale_transporte: { type: 'boolean', description: 'Ausência de VT nas folgas trabalhadas (se tinha VT + fez FTs pagas informalmente → true)' },
    tem_auxilio_alimentacao: { type: 'boolean', description: 'Ausência de VA/VR nas folgas trabalhadas (se tinha VA/VR + fez FTs pagas informalmente → true)' },
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
  const temArquivos = Boolean(fileUrls && fileUrls.length);
  const temTexto = Boolean(texto && texto.trim());
  const blocoTexto = temTexto
    ? `TEXTO DA ENTREVISTA:\n"""\n${texto}\n"""`
    : (temArquivos
      ? 'TEXTO DA ENTREVISTA: (vazio — analise exclusivamente o(s) documento(s) anexado(s) abaixo)'
      : 'TEXTO DA ENTREVISTA: (vazio)');
  const blocoArquivos = temArquivos
    ? `\n\nDOCUMENTO(S) ANEXADO(S): leia integralmente o(s) PDF/imagem enviado(s) e extraia TODOS os campos do caso. O documento é uma entrevista assinada pelo cliente — trate como fonte primária.`
    : '';
  const request = {
    prompt: `Você é uma especialista sênior em direito trabalhista que analisa entrevistas de empregados para montar petições. Leia TODO o material abaixo (entrevista + fatos narrados) e extraia todos os campos com máxima inteligência inferencial — como uma advogada experiente faria.

${blocoTexto}${blocoArquivos}

=== REGRAS DE EXTRAÇÃO ===

DADOS BÁSICOS:
- Datas em YYYY-MM-DD (interprete: 14/04/2025 → 2025-04-14; "Sem JUSTA CAUSA: 07/12/2025" → data_rescisao = 2025-12-07).
- CPF/CNPJ/PIS somente números.
- recl_serie: número de série da CTPS ("serie: 25795" → "25795"). recl_ctps: só o número da CTPS (sem série).
- recl_genero: 'M' ou 'F' inferido do nome ("brasileiro/solteiro" → 'M').

SALÁRIO:
- Extraia o salário mesmo que venha como "Salário: 2148,22" ou "R$ 2.148,22".
- Se não informado explicitamente MAS a função é vigilante e há CCT conhecida, NÃO invente — deixe em branco.

FOLGAS TRABALHADAS (FT):
- "5 a 6 FTs" → ft_qtd_media = 5.5 (use a MÉDIA da faixa).
- "180 a 200" valor das FTs → val_ft = 190.0 (use a MÉDIA da faixa).
- "pagos fora da folha" / "via pix" → tem_integracao_por_fora = true, valor_por_fora = val_ft (as FTs eram pagas informalmente).
- tem_ft = true sempre que houver FTs relatadas.

JORNADA E HORAS EXTRAS:
- Escala 12x36 com horário "18:30 às 07:30" ou "19h às 7h" → tem_adic_noturno = true (labor após 22h é noturno automático).
- "período antecedente 30 min" + "sucedente 30 min" → prorrogacao_jornada = "30 minutos antes e 30 minutos após a jornada" + escala = "12x36 com minutos antecedentes e sucedentes".
- "média de 1h de HE" → prorrogacao_jornada inclui isso.
- Intervalo com "Rádio HT sempre ligado" = intervalo suprimido/reduzido (trabalhador não descansa de fato). intervalo_usufruido = "10 a 15 minutos com rádio HT sempre ligado (sem real descanso)".

ACÚMULO/DESVIO DE FUNÇÃO:
- Acúmulo = exerceu ALÉM das suas funções habituais outras atribuições (ex: Prevenção de Perdas, rondas, recepção).
- Desvio = exerceu funções de cargo SUPERIOR/DIVERSO do contratado.
- "passou a acumular funções de Prevenção de Perdas: conferências de mercadorias, controle de validade, registros, conferência de cargas, controle de paletes" → tem_acumulo = true, acumulo_atividades = descrição completa.
- Defina tem_acumulo = true com suporte explícito; tem_desvio = true se exercia função claramente superior/diferente.

PERICULOSIDADE:
- Vigilante → tem_periculosidade = true POR PADRÃO (Lei 7.102/83 + Portaria MTE 1885/2013 — categoria profissional de vigilância tem adicional de periculosidade mesmo sem armamento pessoal quando guarda patrimônio).
- Só omita se o texto EXPLICITAR que não é da categoria vigilância.

DESCONTO INDEVIDO DE CONSIGNADO:
- "desconto integral do saldo devedor do empréstimo consignado na rescisão" → fatos_narrados deve incluir esse fato; dano_fatos deve mencionar.
- NUNCA omita esse fato dos fatos_narrados.

PARTICIPAÇÃO NOS LUCROS (PL):
- "não recebia PL" → adicionar em fatos_narrados: "não recebimento de PLR (Participação nos Lucros e Resultados)" e considerar tese de PLR devida pela CCT.

VALE-TRANSPORTE / VALE-REFEIÇÃO / VALE-ALIMENTAÇÃO:
- Se marcado "SIM" na entrevista → o benefício ERA fornecido normalmente; verifique se era suprimido nas folgas.
- Se folgas eram trabalhadas e pagas informalmente, VT/alimentação nas folgas provavelmente não eram pagos.
- tem_vale_transporte = true se há FTs e VT era fornecido (presunção de não pagamento nas folgas trabalhadas).
- tem_auxilio_alimentacao = true se há FTs e VA/VR era fornecido (mesma presunção).

TIPO DE DISPENSA:
- "Sem justa causa" marcado no formulário → tipo_dispensa = "sem_justa_causa".
- "pedido de demissão forçado/coagido/constrangido" → nulidade_pedido_demissao.
- Falta grave patronal → rescisao_indireta.

DANO MORAL:
- Acúmulo de funções sem contraprestação + desconto indevido de consignado = fatos concretos para dano moral.
- tem_dano_moral = true se há ao menos 1 fato concreto (humilhação, assédio, desconto indevido, doença sem comunicação, etc.).
- dano_fatos: redija 2-4 frases objetivas descrevendo os fatos concretos do dano (inclua o desconto indevido do consignado e/ou o acúmulo sem compensação).

FATOS NARRADOS:
- Liste TODA irregularidade/fato específico mencionado, um por item, sem omitir NADA:
  ex.: "folgas trabalhadas pagas informalmente via PIX", "acúmulo de função (Prevenção de Perdas) sem contraprestação", "intervalo intrajornada suprimido (rádio HT sempre ligado)", "minutos antecedentes e sucedentes não pagos", "desconto integral de empréstimo consignado na rescisão", "não recebimento de PLR", "periculosidade não remunerada", "vale-transporte/alimentação não pago nas folgas trabalhadas", etc.
- A auditoria cruza esta lista com os capítulos da minuta — nenhum fato pode faltar.

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