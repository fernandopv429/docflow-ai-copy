// ============================================================
// GUIA DE CAMPOS — Dicionário canônico de formato esperado
// para cada campo extraído pela IA. Serve três propósitos:
//
// 1. INJEÇÃO NO PROMPT: gera um bloco de texto com o formato
//    exato, exemplo e impacto de deixar vazio — a IA sabe
//    EXATAMENTE o que deve retornar para cada campo.
//
// 2. VALIDAÇÃO PÓS-EXTRAÇÃO: afterNormalizarCaso() percorre
//    o caso retornado e gera alertas para campos que vieram
//    em formato incorreto, vazios quando não deveriam, ou
//    com valores incoerentes.
//
// 3. RELATÓRIO DE CAMPOS FALTANTES: geraFaltantesTexto()
//    produz uma lista legível dos campos críticos que ficaram
//    vazios, para o usuário ver no chat o que falta.
// ============================================================

// Cada campo: { formato, exemplo, impacto, critico, grupo }
// - critico: true → sem este campo, a peça fica com placeholder [COLCHETE]
//   ou os cálculos rescisórios zeram.
// - impacto: o que ACONTECE no documento se o campo vier vazio.
export const GUIA_CAMPOS = {
  // --- RECLAMANTE ---
  recl_nome: {
    grupo: 'Reclamante',
    formato: 'Texto — nome completo do reclamante (MAIÚSCULAS no template)',
    exemplo: 'JOÃO DA SILVA SANTOS',
    impacto: 'Aparece como [NOME DO RECLAMANTE] no preâmbulo',
    critico: true,
  },
  recl_genero: {
    grupo: 'Reclamante',
    formato: "Letra única: 'M' (masculino) ou 'F' (feminino)",
    exemplo: 'M',
    impacto: 'Toda a concordância de gênero da petição fica errada (brasileiro/a, contratado/a)',
    critico: true,
  },
  recl_nacionalidade: {
    grupo: 'Reclamante',
    formato: 'Texto — nacionalidade concordando com o gênero',
    exemplo: 'brasileiro',
    impacto: 'Aparece em branco ou no gênero errado no preâmbulo',
    critico: false,
  },
  recl_estado_civil: {
    grupo: 'Reclamante',
    formato: 'Texto — estado civil concordando com o gênero',
    exemplo: 'solteiro',
    impacto: 'Aparece como [ESTADO CIVIL] no preâmbulo',
    critico: true,
  },
  recl_cpf: {
    grupo: 'Reclamante',
    formato: 'Somente 11 dígitos (sem pontos/traços)',
    exemplo: '12345678901',
    impacto: 'Aparece como [CPF] na qualificação',
    critico: true,
  },
  recl_rg: {
    grupo: 'Reclamante',
    formato: 'Somente dígitos (sem pontos/traços)',
    exemplo: '123456789',
    impacto: 'Aparece como [RG] na qualificação',
    critico: false,
  },
  recl_pis: {
    grupo: 'Reclamante',
    formato: 'Somente dígitos',
    exemplo: '12345678901',
    impacto: 'Aparece como [PIS] na qualificação',
    critico: false,
  },
  recl_ctps: {
    grupo: 'Reclamante',
    formato: 'Somente o NÚMERO da CTPS (sem série)',
    exemplo: '12345',
    impacto: 'Aparece como [CTPS] na qualificação',
    critico: false,
  },
  recl_serie: {
    grupo: 'Reclamante',
    formato: 'Somente o número da SÉRIE da CTPS',
    exemplo: '25795',
    impacto: 'Aparece como [SÉRIE] na qualificação',
    critico: false,
  },
  recl_nascimento: {
    grupo: 'Reclamante',
    formato: 'Data ISO: YYYY-MM-DD',
    exemplo: '1990-05-15',
    impacto: 'Aparece como [DATA DE NASCIMENTO] no preâmbulo',
    critico: false,
  },
  recl_filiacao: {
    grupo: 'Reclamante',
    formato: 'Texto — nome da mãe E do pai (formato: "Fulana de Tal e Beltrano de Tal")',
    exemplo: 'Maria da Silva e João Santos',
    impacto: 'Aparece como [FILIAÇÃO] no preâmbulo',
    critico: false,
  },
  recl_endereco: {
    grupo: 'Reclamante',
    formato: 'Texto — endereço RESIDENCIAL completo (rua, nº, bairro, cidade/UF, CEP)',
    exemplo: 'Rua das Flores, 123, Centro, São Paulo/SP, CEP 01000-000',
    impacto: 'Aparece como [ENDEREÇO DO RECLAMANTE] no preâmbulo. NUNCA use este endereço como local de prestação.',
    critico: true,
  },
  recl_email: {
    grupo: 'Reclamante',
    formato: 'E-mail pessoal em minúsculas (gmail/hotmail/outlook etc.) — omitir se não houver',
    exemplo: 'joao.silva@gmail.com',
    impacto: 'O template aciona a frase de contingência "sem correio eletrônico"',
    critico: false,
  },

  // --- RECLAMADAS ---
  recl1_nome: {
    grupo: 'Reclamadas',
    formato: 'Texto — razão social INTEGRAL da 1ª reclamada (empregadora)',
    exemplo: 'EMPRESA DE SEGURANÇA LTDA',
    impacto: 'Aparece como [RAZÃO SOCIAL 1ª RECLAMADA] na qualificação',
    critico: true,
  },
  recl1_cnpj: {
    grupo: 'Reclamadas',
    formato: 'Somente 14 dígitos (sem pontos/barras/traços)',
    exemplo: '12345678000199',
    impacto: 'Aparece como [CNPJ - confirmar] e a consulta à Receita Federal não é feita',
    critico: true,
  },
  recl1_logradouro: {
    grupo: 'Reclamadas',
    formato: 'Texto — endereço completo da empregadora (rua, nº, bairro, CEP)',
    exemplo: 'Av. Paulista, 1000, Bela Vista, São Paulo/SP, CEP 01310-100',
    impacto: 'Aparece como [ENDEREÇO - confirmar] e pode usar a residência do reclamante por engano',
    critico: false,
  },
  recl2_nome: {
    grupo: 'Reclamadas',
    formato: 'Texto — razão social da 2ª reclamada (tomadora de serviços) — omitir se não houver',
    exemplo: 'SUPERMERCADO XYZ S.A.',
    impacto: 'A seção de responsabilidade subsidiária (Súm. 331 TST) não é ativada',
    critico: false,
  },
  recl2_cnpj: {
    grupo: 'Reclamadas',
    formato: 'Somente 14 dígitos — omitir se não houver 2ª reclamada',
    exemplo: '98765432000111',
    impacto: 'A tomadora não é consultada na Receita e a qualificação fica incompleta',
    critico: false,
  },
  recl2_logradouro: {
    grupo: 'Reclamadas',
    formato: 'Texto — endereço da TOMADORA (define a competência territorial — art. 651 CLT)',
    exemplo: 'Av. Brg. Faria Lima, 2000, Jardim Paulistano, São Paulo/SP',
    impacto: 'A competência (vara/TRT) pode usar a residência do reclamante — ERRO BLOQUEANTE',
    critico: false,
  },
  local_prestacao: {
    grupo: 'Reclamadas',
    formato: 'Texto — endereço do LOCAL onde os serviços foram prestados (NUNCA a residência do reclamante)',
    exemplo: 'Av. Brg. Faria Lima, 2000, São Paulo/SP',
    impacto: 'Competência territorial errada — a peça é endereçada à vara incorreta',
    critico: true,
  },
  comarca_uf: {
    grupo: 'Reclamadas',
    formato: 'UF com 2 letras maiúsculas',
    exemplo: 'SP',
    impacto: 'A região do TRT fica em branco no endereçamento',
    critico: false,
  },

  // --- CONTRATO ---
  data_admissao: {
    grupo: 'Contrato',
    formato: 'Data ISO: YYYY-MM-DD (interprete DD/MM/YYYY → YYYY-MM-DD)',
    exemplo: '2023-05-10',
    impacto: 'Aparece como [DATA DE ADMISSÃO]. TODOS os cálculos de tempo de serviço, aviso prévio, 13º e férias ficam zerados.',
    critico: true,
  },
  data_rescisao: {
    grupo: 'Contrato',
    formato: 'Data ISO: YYYY-MM-DD (interprete DD/MM/YYYY → YYYY-MM-DD)',
    exemplo: '2025-12-07',
    impacto: 'Aparece como [DATA DE RESCISÃO]. TODOS os cálculos rescisórios (saldo, 13º, férias, FGTS, aviso) ficam zerados.',
    critico: true,
  },
  funcao: {
    grupo: 'Contrato',
    formato: 'Texto — cargo/profissão do reclamante (NUNCA estado civil)',
    exemplo: 'VIGILANTE',
    impacto: 'Aparece como [FUNÇÃO]. Periculosidade, 10 min da CCT e enquadramento não são ativados.',
    critico: true,
  },
  salario: {
    grupo: 'Contrato',
    formato: 'Número decimal (ponto como separador) — valor mensal do salário base',
    exemplo: '2148.22',
    impacto: 'TODOS os cálculos rescisórios (saldo, aviso, 13º, férias, FGTS, multa 40%) ficam zerados. Sem salário a peça é inutilizável.',
    critico: true,
  },
  maior_remuneracao: {
    grupo: 'Contrato',
    formato: 'Número decimal — maior remuneração na função (se ausente, o sistema usa o salário)',
    exemplo: '2800.00',
    impacto: 'O dano moral (10x) usa o salário base em vez da maior remuneração — valor pode ficar menor',
    critico: false,
  },
  tipo_dispensa: {
    grupo: 'Contrato',
    formato: 'Enum: "sem_justa_causa" | "rescisao_indireta" | "nulidade_pedido_demissao" | "reversao_justa_causa" | "acordo"',
    exemplo: 'sem_justa_causa',
    impacto: 'O capítulo de rescisão fica errado e o tipo de aviso prévio (indenizado vs. trabalhado) pode ser incorreto',
    critico: true,
  },

  // --- JORNADA ---
  jornada_horario: {
    grupo: 'Jornada',
    formato: 'Texto — horários de início e fim da jornada (formato legível)',
    exemplo: 'das 19h às 7h',
    impacto: 'Aparece como [HORÁRIOS]. Adicional noturno não é detectado e a narrativa da jornada fica vazia.',
    critico: true,
  },
  escala: {
    grupo: 'Jornada',
    formato: 'Texto — escala de trabalho no formato NxN',
    exemplo: '12x36',
    impacto: 'Aparece como [ESCALA]. As seções condicionais de descaracterização 12x36 ou 4x2 não são ativadas.',
    critico: true,
  },
  intervalo_usufruido: {
    grupo: 'Jornada',
    formato: 'Texto — tempo de intervalo efetivamente gozado (ou "suprimido"/"não gozado")',
    exemplo: '10 a 15 minutos',
    impacto: 'O capítulo do art. 71 CLT (intervalo intrajornada) fica sem narrativa concreta',
    critico: false,
  },
  prorrogacao_jornada: {
    grupo: 'Jornada',
    formato: 'Texto — extensão habitual da jornada além do contratado',
    exemplo: '30 minutos antes e 30 minutos após a jornada',
    impacto: 'O capítulo de horas extras fica sem detalhamento do sobrejornada',
    critico: false,
  },
  val_ft: {
    grupo: 'Jornada',
    formato: 'Número decimal — valor pago por CADA folga trabalhada (R$)',
    exemplo: '190.00',
    impacto: 'O cálculo de folgas trabalhadas (100%) fica zerado',
    critico: false,
  },
  ft_qtd_media: {
    grupo: 'Jornada',
    formato: 'Número decimal — média de folgas/feriados trabalhados por mês (se faixa, use a média)',
    exemplo: '5.5',
    impacto: 'O cálculo de folgas trabalhadas (100%) fica zerado',
    critico: false,
  },

  // --- TESES (DADOS DE APOIO) ---
  desvio_atividades: {
    grupo: 'Teses',
    formato: 'Texto — descrição COMPLETA das atividades de função superior/diversa (mín. 20 caracteres)',
    exemplo: 'Prevenção de Perdas: conferência de mercadorias, controle de validade de produtos, conferência de cargas, contagem de paletes, registros operacionais',
    impacto: 'O capítulo de desvio de função fica com "atividades diversas da função contratada" (genérico) e a multa de 50% perde fundamentação',
    critico: false,
  },
  acumulo_atividades: {
    grupo: 'Teses',
    formato: 'Texto — tarefas extras acumuladas DIFERENTES do desvio (se for o mesmo fato, use apenas desvio)',
    exemplo: 'Rondas de vigilância, recepção de visitantes, limpeza do posto',
    impacto: 'O capítulo de acúmulo fica sem descrição e a multa de 20% perde força',
    critico: false,
  },
  dano_fatos: {
    grupo: 'Teses',
    formato: 'Texto — 2 a 4 frases objetivas descrevendo os FATOS CONCRETOS do dano moral (mín. 80 caracteres)',
    exemplo: 'O reclamante era compelido a exercer atribuições alheias à função contratada (desvio de função — Prevenção de Perdas) sem contraprestação. As folgas trabalhadas eram pagas informalmente via PIX, à margem da folha salarial. Tais condutas violaram a dignidade pessoal do autor.',
    impacto: 'O capítulo de dano moral fica com narrativa genérica determinística (sem os fatos específicos do caso)',
    critico: false,
  },
  insalubridade_descricao: {
    grupo: 'Teses',
    formato: 'Texto — descrição do ambiente insalubre (odor, ausência de ventilação, EPI inadequado)',
    exemplo: 'Ambiente de trabalho insalubre com forte odor proveniente de EVA, sem circulação de ar adequada e EPIs inadequados',
    impacto: 'A flag de insalubridade é DESATIVADA (regra de dependência) e o capítulo não aparece na peça',
    critico: false,
  },
  doenca_descricao: {
    grupo: 'Teses',
    formato: 'Texto — descrição objetiva da doença/lesão e sua relação com o trabalho (2-3 frases)',
    exemplo: 'Hérnia de disco lombar diagnosticada em 2024, decorrente do esforço físico repetitivo na função de vigilante (postura ortostática prolongada). Afastamento pelo INSS (auxílio-doença acidentário B91) por 60 dias.',
    impacto: 'As flags de doença, estabilidade e pensão são DESATIVADAS e os capítulos não aparecem',
    critico: false,
  },
  salarios_aberto: {
    grupo: 'Teses',
    formato: 'Texto — meses de salário não pagos (mês/ano)',
    exemplo: 'julho e dezembro de 2024',
    impacto: 'O capítulo de salários em aberto fica sem especificação dos períodos',
    critico: false,
  },
  valor_por_fora: {
    grupo: 'Teses',
    formato: 'Número decimal — valor médio pago por fora (R$)',
    exemplo: '190.00',
    impacto: 'O cálculo de integração de valores por fora fica zerado',
    critico: false,
  },
  gratificacao_valor: {
    grupo: 'Teses',
    formato: 'Número decimal — valor mensal fixo da gratificação/bônus (R$)',
    exemplo: '125.00',
    impacto: 'O cálculo de gratificação de função (10%) fica zerado',
    critico: false,
  },

  // --- CCT ---
  cct_ano: {
    grupo: 'CCT',
    formato: 'Texto — ano da CCT aplicável',
    exemplo: '2025',
    impacto: 'A referência à CCT no capítulo de multas fica sem ano',
    critico: false,
  },
  cct_clausula_multa: {
    grupo: 'CCT',
    formato: 'Texto — número da cláusula da multa convencional (ex.: "64ª")',
    exemplo: '64ª',
    impacto: 'O capítulo de multas convencionais fica sem o número da cláusula',
    critico: false,
  },

  // --- FLAGS (teses) ---
  tem_ft: {
    grupo: 'Flags',
    formato: 'Boolean — true se houver folgas/feriados trabalhados',
    exemplo: 'true',
    impacto: 'Os capítulos de folgas trabalhadas, VT nas folgas e auxílio-alimentação nas folgas NÃO aparecem',
    critico: false,
  },
  tem_dano_moral: {
    grupo: 'Flags',
    formato: 'Boolean — true se houver ao menos 1 fato concreto (humilhação, desconto indevido, insalubridade, desvio, etc.)',
    exemplo: 'true',
    impacto: 'O capítulo de dano moral NÃO aparece na peça',
    critico: false,
  },
  tem_desvio: {
    grupo: 'Flags',
    formato: 'Boolean — true se exercia função superior/diversa (NUNCA cumular com tem_acumulo sobre os mesmos fatos)',
    exemplo: 'true',
    impacto: 'O capítulo de desvio de função e a multa de 50% NÃO aparecem',
    critico: false,
  },
  tem_adic_noturno: {
    grupo: 'Flags',
    formato: 'Boolean — true APENAS se a jornada cruza 22h-05h (NÃO presumir para jornadas diurnas)',
    exemplo: 'true',
    impacto: 'O capítulo de adicional noturno e hora noturna reduzida NÃO aparece (ou aparece indevidamente se marcado errado)',
    critico: false,
  },
  tem_periculosidade: {
    grupo: 'Flags',
    formato: 'Boolean — true para vigilante/vigia armado (presunção legal); false para porteiro/controlador desarmado',
    exemplo: 'true',
    impacto: 'O capítulo de periculosidade nas horas extras NÃO aparece (ou aparece indevidamente)',
    critico: false,
  },
};

// ============================================================
// Gera o bloco de texto "GUIA DE CAMPOS" para injetar no prompt
// da IA extratora. Mostra o formato exato, exemplo e consequência
// de deixar vazio para CADA campo.
// ============================================================
export function gerarGuiaCamposTexto() {
  const grupos = {};
  for (const [campo, spec] of Object.entries(GUIA_CAMPOS)) {
    if (!grupos[spec.grupo]) grupos[spec.grupo] = [];
    grupos[spec.grupo].push({ campo, ...spec });
  }

  const blocos = [];
  for (const [grupo, campos] of Object.entries(grupos)) {
    const linhas = campos.map((c) => {
      const criticidade = c.critico ? ' [CRÍTICO]' : '';
      return `  • ${c.campo}${criticidade}\n    Formato: ${c.formato}\n    Exemplo: ${c.exemplo}\n    Se vazio: ${c.impacto}`;
    });
    blocos.push(`--- ${grupo.toUpperCase()} ---\n${linhas.join('\n')}`);
  }

  return `\n=== GUIA DE CAMPOS — FORMATO ESPERADO PARA CADA FIELD ===
Cada campo abaixo tem um FORMATO exato. Retorne o valor NO FORMATO INDICADO — nunca em branco, nunca com placeholder, nunca com texto do rótulo da entrevista misturado.

[CRÍTICO] = sem este campo, a peça fica com [COLCHETE] ou os cálculos zeram. Extraia por TODOS os meios (rótulo, inferência, PDF).

${blocos.join('\n\n')}

=== FIM DO GUIA DE CAMPOS ===

REGRAS DE PREENCHIMENTO:
1. Se o dado ESTÁ na entrevista (mesmo sob outro rótulo), extraia SEMPRE. "CARGO:" = "FUNÇÃO:", "ESCALA/HORARIO:" = "Jornada:", "TEMPO LABORADO:" = datas de admissão e rescisão.
2. Se o dado NÃO está, OMITA o campo (não retorne null, "" ou placeholder).
3. Campos [CRÍTICO] vazios = a peça é inutilizável. Faça inferência máxima: nome → gênero, "brasileiro" → M, datas de "Sem justa causa: 07/12/2025" → data_rescisao.
4. NUNCA misture texto do rótulo no valor: "FUNÇÃO: VIGILANTE" → funcao = "VIGILANTE" (não "FUNÇÃO: VIGILANTE").
5. Valores numéricos: ponto como separador decimal, sem R$, sem separador de milhar (R$ 2.148,22 → 2148.22).
6. Datas: SEMPRE YYYY-MM-DD (07/12/2025 → 2025-12-07).
7. dano_fatos: mínimo 80 caracteres de conteúdo real. Se só houver um fragmento como "direitos lesados", DESCREVA os fatos: desvio, folgas via PIX, desconto indevido, etc.`;
}

// ============================================================
// Validação pós-extração: percorre o caso retornado pela IA e
// gera alertas estruturados para campos que:
// - São críticos e ficaram vazios
// - Vieram em formato incorreto (número como string, data fora de ISO, etc.)
// - Têm dependência não atendida (flag sem campo de apoio)
// ============================================================
export function validarFormatoCampos(caso) {
  const alertas = [];

  const ehVazio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

  // 1) Campos críticos vazios
  for (const [campo, spec] of Object.entries(GUIA_CAMPOS)) {
    if (!spec.critico) continue;
    if (ehVazio(caso[campo])) {
      alertas.push({
        severidade: 'BLOQUEANTE',
        campo,
        tipo: 'critico_vazio',
        descricao: `Campo CRÍTICO "${campo}" está vazio. ${spec.impacto}`,
      });
    }
  }

  // 2) Validação de formato por tipo
  const validacoes = [
    { campo: 'recl_cpf', regra: (v) => /^\d{11}$/.test(String(v)), erro: 'CPF deve ter 11 dígitos (sem pontos/traços)' },
    { campo: 'recl1_cnpj', regra: (v) => /^\d{14}$/.test(String(v)), erro: 'CNPJ deve ter 14 dígitos (sem pontos/barras/traços)' },
    { campo: 'recl2_cnpj', regra: (v) => !v || /^\d{14}$/.test(String(v)), erro: 'CNPJ da 2ª reclamada deve ter 14 dígitos' },
    { campo: 'data_admissao', regra: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)), erro: 'Data de admissão deve estar em formato ISO: YYYY-MM-DD' },
    { campo: 'data_rescisao', regra: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)), erro: 'Data de rescisão deve estar em formato ISO: YYYY-MM-DD' },
    { campo: 'recl_genero', regra: (v) => v === 'M' || v === 'F', erro: 'Gênero deve ser "M" ou "F"' },
    { campo: 'tipo_dispensa', regra: (v) => ['sem_justa_causa', 'rescisao_indireta', 'nulidade_pedido_demissao', 'reversao_justa_causa', 'acordo'].includes(v), erro: 'Tipo de dispensa deve ser um dos valores do enum' },
    { campo: 'comarca_uf', regra: (v) => !v || /^[A-Za-z]{2}$/.test(String(v)), erro: 'UF deve ter 2 letras' },
  ];

  for (const val of validacoes) {
    const v = caso[val.campo];
    if (ehVazio(v)) continue; // já alertado acima se crítico
    if (!val.regra(v)) {
      alertas.push({
        severidade: 'ATENCAO',
        campo: val.campo,
        tipo: 'formato_incorreto',
        descricao: `${val.erro}. Valor recebido: "${v}"`,
      });
    }
  }

  // 3) Validação de campos numéricos (devem ser number, não string)
  const camposNumericos = ['salario', 'maior_remuneracao', 'val_ft', 'val_conducao', 'ft_qtd_media', 'valor_por_fora', 'gratificacao_valor', 'assiduidade_prometido', 'assiduidade_pago'];
  for (const campo of camposNumericos) {
    const v = caso[campo];
    if (ehVazio(v)) continue;
    if (typeof v === 'string') {
      alertas.push({
        severidade: 'INFO',
        campo,
        tipo: 'numero_como_string',
        descricao: `Campo "${campo}" veio como string ("${v}") em vez de number. O sistema converte, mas a IA deveria retornar número.`,
      });
    }
  }

  // 4) dano_fatos: mínimo de conteúdo
  if (!ehVazio(caso.dano_fatos) && String(caso.dano_fatos).trim().length < 80) {
    alertas.push({
      severidade: 'ATENCAO',
      campo: 'dano_fatos',
      tipo: 'conteudo_insuficiente',
      descricao: `dano_fatos tem apenas ${String(caso.dano_fatos).trim().length} caracteres (mínimo 80). A narrativa do dano moral ficará genérica.`,
    });
  }

  // 5) desvio_atividades: mínimo de conteúdo
  if (!ehVazio(caso.desvio_atividades) && String(caso.desvio_atividades).trim().length < 20) {
    alertas.push({
      severidade: 'ATENCAO',
      campo: 'desvio_atividades',
      tipo: 'conteudo_insuficiente',
      descricao: `desvio_atividades tem apenas ${String(caso.desvio_atividades).trim().length} caracteres. Descreva as atividades concretas (ex.: "Prevenção de Perdas: conferência de cargas, controle de validade...").`,
    });
  }

  // 6) Local de prestação = endereço residencial (ERRO BLOQUEANTE)
  if (caso.local_prestacao && caso.recl_endereco) {
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (norm(caso.local_prestacao) === norm(caso.recl_endereco)) {
      alertas.push({
        severidade: 'BLOQUEANTE',
        campo: 'local_prestacao',
        tipo: 'igual_residencia',
        descricao: 'local_prestacao é IGUAL ao endereço residencial do reclamante — use o endereço da tomadora ou da empregadora (art. 651 CLT).',
      });
    }
  }

  // 7) Salário = 0 (zeraria todos os cálculos)
  if (caso.salario !== undefined && caso.salario !== null && caso.salario !== '' && Number(caso.salario) === 0) {
    alertas.push({
      severidade: 'BLOQUEANTE',
      campo: 'salario',
      tipo: 'salario_zero',
      descricao: 'Salário extraído como 0 — TODOS os cálculos rescisórios ficarão zerados. Verificar se o valor foi lido corretamente.',
    });
  }

  return alertas;
}

// ============================================================
// Gera texto legível dos campos críticos faltantes para exibir
// no chat do usuário (entrevista session).
// ============================================================
export function gerarFaltantesTexto(caso) {
  const faltantes = [];
  for (const [campo, spec] of Object.entries(GUIA_CAMPOS)) {
    if (!spec.critico) continue;
    const v = caso?.[campo];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) {
      faltantes.push({
        campo,
        impacto: spec.impacto,
      });
    }
  }
  if (!faltantes.length) return null;
  return `Campos críticos não extraídos:\n${faltantes.map((f) => `• ${f.campo}: ${f.impacto}`).join('\n')}`;
}