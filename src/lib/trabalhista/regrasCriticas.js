// Regras críticas extraídas da comparação entre a minuta gerada pela IA e a
// minuta de referência revisada pelo advogado. No nosso fluxo, `blocoRegrasCriticas`
// é injetado no contexto compartilhado dos especialistas por tópico (e na
// auditoria de coerência) para evitar a repetição dos mesmos erros.
// `regiaoTrtPorMunicipio` é DETERMINÍSTICO — a IA não decide competência.

// Competência: o TRT decorre do município da prestação de serviços (art. 651 CLT).
// A Grande São Paulo, Baixada Santista e Litoral pertencem ao TRT da 2ª Região;
// o interior do Estado (Campinas e região) ao TRT da 15ª Região.
export const MUNICIPIOS_TRT2 = [
  'são paulo', 'itapecerica da serra', 'embu', 'embu das artes', 'embu-guaçu', 'taboão da serra',
  'osasco', 'carapicuíba', 'cotia', 'barueri', 'jandira', 'itapevi', 'guarulhos', 'santo andré',
  'são bernardo do campo', 'são caetano do sul', 'diadema', 'mauá', 'ribeirão pires',
  'rio grande da serra', 'mogi das cruzes', 'suzano', 'poá', 'itaquaquecetuba', 'ferraz de vasconcelos',
  'arujá', 'santa isabel', 'caieiras', 'franco da rocha', 'francisco morato', 'mairiporã',
  'santana de parnaíba', 'pirapora do bom jesus', 'juquitiba', 'são lourenço da serra',
  'santos', 'são vicente', 'guarujá', 'cubatão', 'praia grande', 'itanhaém', 'peruíbe',
  'mongaguá', 'bertioga', 'caraguatatuba', 'são sebastião', 'ubatuba', 'ilhabela',
];

export function regiaoTrtPorMunicipio(municipio) {
  const m = (municipio || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const achou = MUNICIPIOS_TRT2.some(
    (nome) => m.includes(nome.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  );
  return achou ? '2ª Região (TRT-2)' : null;
}

export function blocoRegrasCriticas({ municipios = [] } = {}) {
  const trt2 = municipios.filter((m) => regiaoTrtPorMunicipio(m));
  const orientacaoTrt = trt2.length
    ? `O local de prestação (${trt2.join(', ')}) pertence ao TRT da 2ª Região. Enderece a peça a "AO JUÍZO DA VARA DO TRABALHO DE ${trt2[0].toUpperCase()} – SEGUNDA REGIÃO" (ou à Vara de São Paulo, se for o caso). NUNCA use TRT da 15ª Região para esses municípios.`
    : 'Confirme o TRT pelo município de prestação: Grande São Paulo, Baixada Santista e Litoral = TRT da 2ª Região; interior/Campinas = TRT da 15ª Região. Em dúvida, use o marcador [REGIÃO DO TRT - confirmar]; nunca "adivinhe" a região.';

  return `

REGRAS CRÍTICAS (erros já cometidos em minutas anteriores — NÃO repita):
1. COMPETÊNCIA / TRT: ${orientacaoTrt}
2. ESCALA: use EXCLUSIVAMENTE a escala efetivamente relatada na entrevista. Se o relato é 12x36, trate apenas de 12x36 (prorrogação, folgas laboradas). É PROIBIDO criar tópicos, quadros sinóticos ou jurisprudência sobre escalas que o relato não menciona (ex.: 4x2, 5x2, 6x1 quando o caso é 12x36).
3. DESVIO × ACÚMULO DE FUNÇÃO: são pedidos ALTERNATIVOS e mutuamente excludentes para o MESMO conjunto de tarefas. Escolha UM só (desvio, quando executa tarefas de outro cargo; acúmulo, quando soma as atribuições de dois cargos) e peça apenas a multa convencional correspondente. NUNCA cumule os dois com base nos mesmos fatos.
4. HONORÁRIOS: não inclua o valor dos honorários no array do CONTRATO DE SAÍDA (são calculados à parte pelo sistema, sobre o valor da causa).
5. VALORES ESTIMADOS: calcule cada pedido a partir dos dados reais do caso (salário base × meses trabalhados × percentual aplicável). É PROIBIDO lançar valores redondos genéricos e altos (ex.: R$ 15.000,00 "a apurar") — sempre apresente um valor numérico proporcional por item (um único valor final por item, já somando os reflexos DESSE item).
6. VALOR DA CAUSA E FECHO SÃO CALCULADOS POR CÓDIGO, NÃO POR VOCÊ: não escreva a frase "Dá-se à causa o valor de...", não some os itens, não escreva "Pede deferimento", a data do fecho ("São Paulo, ...") nem a assinatura. Termine sua resposta no último requerimento final e, na sequência, no formato exigido no CONTRATO DE SAÍDA descrito no prompt principal. Isso existe porque, em testes reais, a IA já errou tanto a soma final quanto a data do fecho ao escrevê-las livremente — agora o código faz isso de forma determinística.`;
}