import { base44 } from '@/api/base44Client';
import { traceAiCall } from '@/lib/sessionTrace';

// ============================================================
// Agente extrator: converte texto livre e/ou PDF da entrevista
// nos campos usados pelo MODELO-MESTRE (via dadosTemplate.js).
//
// Princípios aplicados:
// 1. VALIDAÇÃO DE INPUTS — null/undefined/vazio tratados com fallback seguro.
// 2. REGRAS CONDICIONAIS — cada tese só permanece ativa se TODOS os campos
//    de apoio estiverem validados; inconsistências viram alertas estruturados.
// 3. PADRONIZAÇÃO DO RETORNO — objeto JSON limpo, aderente ao schema,
//    sem textos explicativos/saudações.
// ============================================================

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

    // Flags das teses (true APENAS com suporte no relato + campos de apoio validados)
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

// ============================================================
// Helpers de validação / normalização (fallbacks seguros)
// ============================================================
function ehVazio(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function comoString(v) {
  if (ehVazio(v)) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function comoNumero(v) {
  if (ehVazio(v)) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const limpo = String(v).replace(/R\$\s*/gi, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : undefined;
}

function comoBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return undefined;
}

function comoArrayStrings(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

// ============================================================
// Regras de dependência: cada flag só permanece TRUE se TODOS
// os campos de apoio estiverem presentes e validados.
// Inconsistências → alerta estruturado (não interrompe execução).
// ============================================================
const REGRAS_TESES = [
  { flag: 'tem_ft', exige: ['ft_qtd_media'], descricao: 'Folgas trabalhadas ativadas sem quantitativo médio (ft_qtd_media).' },
  { flag: 'tem_acumulo', exige: ['acumulo_atividades'], descricao: 'Acúmulo de função ativado sem descrição das atividades.' },
  { flag: 'tem_desvio', exige: ['desvio_atividades'], descricao: 'Desvio de função ativado sem descrição das atividades.' },
  { flag: 'tem_assiduidade', exige: ['assiduidade_prometido'], descricao: 'Assiduidade ativada sem valor prometido.' },
  { flag: 'tem_doenca', exige: ['doenca_descricao'], descricao: 'Doença ativada sem descrição.' },
  { flag: 'tem_integracao_por_fora', exige: ['valor_por_fora'], descricao: 'Integração por fora ativada sem valor.' },
  { flag: 'tem_dano_moral', exige: ['dano_fatos'], descricao: 'Dano moral ativado sem fato concreto descrito.' },
  { flag: 'tem_salarios_aberto', exige: ['salarios_aberto'], descricao: 'Salários em aberto ativados sem indicação dos meses.' },
  { flag: 'tem_estabilidade', exige: ['doenca_descricao'], descricao: 'Estabilidade ativada sem doença descrita (a estabilidade acompanha a doença).' },
];

// Campos do schema categorizados por tipo para coerção determinística.
const CAMPOS_STRING = [
  'titulo', 'recl_nome', 'recl_genero', 'recl_nacionalidade', 'recl_estado_civil', 'recl_cpf', 'recl_rg',
  'recl_pis', 'recl_ctps', 'recl_serie', 'recl_nascimento', 'recl_filiacao', 'recl_endereco',
  'recl1_nome', 'recl1_cnpj', 'recl1_logradouro', 'recl2_nome', 'recl2_cnpj', 'local_prestacao', 'comarca_uf',
  'data_admissao', 'data_rescisao', 'funcao', 'tipo_dispensa', 'jornada_horario', 'escala',
  'intervalo_usufruido', 'prorrogacao_jornada', 'acumulo_atividades', 'desvio_atividades',
  'salarios_aberto', 'doenca_descricao', 'cct_ano', 'cct_clausulas', 'cct_clausula_multa',
  'periodo_ferias_prop', 'periodo_13', 'periodo_ferias_vencidas', 'dano_fatos',
];
const CAMPOS_NUMERO = [
  'salario', 'maior_remuneracao', 'val_ft', 'val_conducao', 'ft_qtd_media',
  'assiduidade_prometido', 'assiduidade_pago', 'assiduidade_diferenca',
  'valor_por_fora', 'valor_aux_alimentacao',
];
const CAMPOS_BOOLEAN = [
  'tem_acumulo', 'tem_desvio', 'tem_gratificacao', 'tem_dez_min_cct', 'tem_salarios_aberto',
  'tem_adic_noturno', 'tem_integracao_por_fora', 'tem_periculosidade', 'tem_assiduidade',
  'tem_vale_transporte', 'tem_auxilio_alimentacao', 'tem_doenca', 'tem_estabilidade',
  'tem_pensao', 'tem_ft', 'tem_ferias_vencidas', 'tem_dano_moral',
];

// ============================================================
// Normaliza o retorno bruto da IA: aplica fallbacks seguros,
// valida regras condicionais e coleta alertas estruturados.
// Retorna { caso, alertas } — caso sempre aderente ao schema.
// ============================================================
function normalizarCaso(bruto) {
  const alertas = [];
  const caso = {};

  // 1) Coerção de tipos com fallback (undefined = campo ausente, nunca null/'')
  for (const c of CAMPOS_STRING) {
    const v = comoString(bruto?.[c]);
    if (v !== undefined) caso[c] = v;
  }
  for (const c of CAMPOS_NUMERO) {
    const v = comoNumero(bruto?.[c]);
    if (v !== undefined) caso[c] = v;
  }
  for (const c of CAMPOS_BOOLEAN) {
    const v = comoBoolean(bruto?.[c]);
    if (v !== undefined) caso[c] = v;
  }
  caso.fatos_narrados = comoArrayStrings(bruto?.fatos_narrados);

  // 2) Validação das regras condicionais — desativa flag inconsistente + alerta
  for (const regra of REGRAS_TESES) {
    if (caso[regra.flag] !== true) continue;
    const faltantes = regra.exige.filter((c) => ehVazio(caso[c]));
    if (faltantes.length) {
      caso[regra.flag] = false;
      alertas.push({
        severidade: 'ATENCAO',
        flag: regra.flag,
        campos_faltantes: faltantes,
        descricao: regra.descricao,
      });
    }
  }

  // 3) Consistências cruzadas — alertas informativos (não desativam)
  if (caso.tem_periculosidade && caso.funcao && !/vigilante|vigil/i.test(caso.funcao)) {
    alertas.push({
      severidade: 'INFO',
      flag: 'tem_periculosidade',
      descricao: `Periculosidade ativa mas a função "${caso.funcao}" não parece ser de vigilância — confirmar enquadramento.`,
    });
  }
  if (caso.data_admissao && caso.data_rescisao && caso.data_rescisao < caso.data_admissao) {
    alertas.push({
      severidade: 'ATENCAO',
      campos: ['data_admissao', 'data_rescisao'],
      descricao: 'Data de rescisão anterior à data de admissão — verificar datas informadas.',
    });
  }
  if (caso.recl1_cnpj && caso.recl1_cnpj.replace(/\D/g, '').length !== 14) {
    alertas.push({
      severidade: 'ATENCAO',
      campo: 'recl1_cnpj',
      descricao: 'CNPJ da 1ª reclamada não possui 14 dígitos — conferir na Receita.',
    });
  }

  return { caso, alertas };
}

// ============================================================
// Função principal: extrai o caso de texto livre e/ou PDF.
// Nunca lança — retorna { caso: {}, alertas: [] } em qualquer falha.
// ============================================================
export async function extrairCasoDeTexto(texto, fileUrls) {
  // --- 1) Validação de inputs ---
  const textoSeguro = typeof texto === 'string' ? texto.trim() : '';
  const urlsSeguras = Array.isArray(fileUrls) ? fileUrls.filter(Boolean) : [];
  const temTexto = Boolean(textoSeguro);
  const temArquivos = Boolean(urlsSeguras.length);

  // Fallback: sem material algum, retorna vazio (não interrompe o fluxo)
  if (!temTexto && !temArquivos) {
    return { caso: {}, alertas: [{ severidade: 'BLOQUEANTE', descricao: 'Sem texto e sem documento anexado — nada a extrair.' }] };
  }

  // --- 2) Montagem do prompt (sem saudações no output, só JSON) ---
  const blocoTexto = temTexto
    ? `TEXTO DA ENTREVISTA:\n"""\n${textoSeguro}\n"""`
    : 'TEXTO DA ENTREVISTA: (vazio — analise exclusivamente o(s) documento(s) anexado(s))';
  const blocoArquivos = temArquivos
    ? `\n\nDOCUMENTO(S) ANEXADO(S): leia integralmente o(s) PDF/imagem enviado(s) e extraia TODOS os campos do caso. O documento é uma entrevista assinada pelo cliente — trate como fonte primária.`
    : '';

  const request = {
    prompt: `Você é uma especialista sênior em direito trabalhista que analisa entrevistas de empregados para montar petições. Leia TODO o material abaixo e extraia todos os campos com máxima inteligência inferencial — como uma advogada experiente faria.

${blocoTexto}${blocoArquivos}

=== REGRAS DE EXTRAÇÃO ===

DADOS BÁSICOS:
- Datas em YYYY-MM-DD (interprete: 14/04/2025 → 2025-04-14; "Sem JUSTA CAUSA: 07/12/2025" → data_rescisao = 2025-12-07).
- CPF/CNPJ/PIS somente números.
- recl_serie: número de série da CTPS ("serie: 25795" → "25795"). recl_ctps: só o número da CTPS (sem série).
- recl_genero: 'M' ou 'F' inferido do nome ("brasileiro/solteiro" → 'M').

MUNICÍPIO/GRAFIA:
- Grafia correta dos municípios: "Itapecerica da Serra/SP" (NUNCA "Itapecerica da Terra"), "São Paulo/SP", "Osasco/SP".
- comarca_uf: UF com 2 letras. local_prestacao: endereço completo do local onde o reclamante prestava serviços (define a competência territorial — art. 651 CLT).
- Se houver CEP, complete o município/UF; confira a grafia antes de gravar.

MULTA CONVENCIONAL:
- cct_clausula_multa: extraia SEMPRE o número da cláusula da CCT que prevê a multa por descumprimento (ex.: "Cláusula 64ª" → "64ª"). NUNCA deixe em branco se houver CCT aplicável.
- cct_clausulas: liste as cláusulas específicas citadas na entrevista com numeração.

AUXÍLIO-ALIMENTAÇÃO:
- valor_aux_alimentacao: valor DIÁRIO unitário estipulado pela CCT (ex.: R$ 25,00/dia → 25.0). Extraia mesmo se não mencionado explicitamente quando há CCT conhecida e folgas trabalhadas.

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

ESCALA 4X2/6X2 (jornada NÃO 12x36):
- Se a escala informada NÃO for 12x36 (ex.: "4x2", "6x2", "6x1" com labor habitual em dia de folga) → preencha `escala` com o texto exato informado (ex.: "4x2"); a seção de descaracterização correspondente é ativada automaticamente pelo código a partir desse texto, não precisa de flag própria aqui.

DOENÇA OCUPACIONAL / ESTABILIDADE / PENSÃO (seção 13 "Saúde" do formulário — doença/insalubridade/periculosidade/EPI):
- Se a entrevista relatar QUALQUER doença, lesão, LER/DORT, problema de coluna, perda auditiva, intoxicação ou acidente de trabalho relacionado à função exercida → tem_doenca = true e doenca_descricao = descrição objetiva da doença/lesão e de como se relaciona ao trabalho (2-3 frases).
- Se a doença/acidente foi comunicada à empresa e/ou gerou afastamento pelo INSS (auxílio-doença acidentário, espécie B91) e a dispensa ocorreu no período de estabilidade (12 meses após a cessação do benefício) ou sem observância dela → tem_estabilidade = true. NÃO marque se a doença não teve relação ocupacional demonstrável ou se não houve afastamento previdenciário indicado.
- Se houver relato de sequela, redução de capacidade laborativa ou incapacidade (ainda que parcial) decorrente da doença/acidente ocupacional → tem_pensao = true. NÃO marque apenas por haver doença sem indício de redução de capacidade — pensão vitalícia exige dano permanente, não simples afastamento temporário.
- Essas 3 flags (tem_doenca, tem_estabilidade, tem_pensao) SEMPRE dependem de doenca_descricao preenchida — nunca as marque true com o campo vazio.

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

=== RETORNO ===
Responda APENAS com o objeto JSON. NÃO inclua introduções, saudações, comentários ou qualquer texto fora do JSON. Campos sem informação: omita (não retorne null, "" ou placeholders).`,
    model: 'claude_sonnet_4_6',
    response_json_schema: CASO_SCHEMA,
  };
  if (urlsSeguras.length) request.file_urls = urlsSeguras;

  // --- 3) Chamada à IA com fallback estruturado (nunca lança) ---
  let bruto;
  try {
    bruto = await traceAiCall('Extração estruturada do caso', request, () =>
      base44.integrations.Core.InvokeLLM(request)
    );
  } catch (erro) {
    return {
      caso: {},
      alertas: [{ severidade: 'BLOQUEANTE', descricao: `Falha na extração pela IA: ${erro?.message || 'erro desconhecido'}` }],
    };
  }

  // --- 3b) Desembrulhar resposta defensivamente ---
  // Alguns modelos/devoluções chegam como string JSON ou aninhados em uma
  // chave wrapper (caso/data/result/output). Sem isso, normalizarCaso lê
  // bruto.recl_nome → undefined e TODOS os campos viram colchetes vazios.
  if (typeof bruto === 'string') {
    try { bruto = JSON.parse(bruto); } catch { bruto = {}; }
  }
  if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) {
    const temCampoDireto = CAMPOS_STRING.some((c) => bruto[c] != null && bruto[c] !== '');
    if (!temCampoDireto) {
      const wrapper = bruto.caso || bruto.data || bruto.result || bruto.output || bruto.dados || bruto.extraido;
      if (wrapper && typeof wrapper === 'object') bruto = wrapper;
    }
  }
  if (!bruto || typeof bruto !== 'object') bruto = {};

  // --- 4) Normalização + validação de regras + alertas ---
  const { caso, alertas } = normalizarCaso(bruto);
  return { caso, alertas };
}