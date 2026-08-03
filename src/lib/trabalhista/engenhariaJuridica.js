// Diretrizes de "engenharia jurídica" do escritório: matrizes condicionais que
// eliminam os erros recorrentes (competência, tese rescisória, enquadramento
// funcional, jornada, dano moral e cálculo dos pedidos).
//
// No nosso fluxo (especialistas por tópico), este bloco é a base do PREÂMBULO
// COMPARTILHADO: cada especialista recebe o caso completo + estas diretrizes,
// mas redige APENAS o capítulo do seu tópico. O cálculo continua determinístico
// (mathUtils) — as instruções de valor aqui servem só como reforço textual.

export const MUNICIPIOS_TRT15 = [
  'campinas', 'vinhedo', 'jundiaí', 'sorocaba', 'ribeirão preto', 'bauru',
  'piracicaba', 'limeira', 'americana', 'são josé dos campos', 'taubaté', 'araraquara',
];

export const BLOCO_ENGENHARIA_JURIDICA = `

DIRETRIZES DE ENGENHARIA JURÍDICA (obrigatórias):

B) TESE RESCISÓRIA — selecione UMA conforme o relato:
- Dispensa sem justa causa: saldo de salário, aviso prévio indenizado (Lei 12.506/11), férias + 1/3, 13º proporcional e FGTS + 40%, sem capítulo de reversão/rescisão indireta.
- Pedido de demissão sob coação/ameaça: incluir "DA ANULAÇÃO DO PEDIDO DE DEMISSÃO E CONVOLAÇÃO EM DISPENSA IMOTIVADA" (art. 171, II, CC c/c art. 9º CLT), com pedido expresso de nulidade.
- Justa causa injusta: incluir "DA REVERSÃO DA DISPENSA POR JUSTA CAUSA" (art. 482 CLT; ônus do empregador; ausência de falta grave e desproporcionalidade da punição).
- Rescisão indireta: incluir "DA RESCISÃO INDIRETA DO CONTRATO DE TRABALHO" (art. 483, "b" e "d", CLT), com rol das faltas graves do empregador; a multa do art. 477 fica subsidiária.

C) ENQUADRAMENTO FUNCIONAL (nunca cumular teses sobre os mesmos fatos):
- Vigilante executando prevenção de perdas, conferência de cargas ou controle de validade de produtos → SOMENTE DESVIO DE FUNÇÃO (multa convencional de 50% por mês — cláusula 64ª da CCT de vigilância).
- Vigilante conduzindo veículo/moto (motoronda) → GRATIFICAÇÃO DE FUNÇÃO de 10% sobre o salário base (cláusula 3ª).
- Porteiro/controlador executando rondas de vigilante → ACÚMULO DE FUNÇÃO de 20% sobre o salário.

D) JORNADA E DANO MORAL:
- Trate exclusivamente da escala relatada. Em 12x36, aborde a extensão habitual, a supressão do intervalo intrajornada (art. 71 CLT), os minutos de troca de uniforme antes/depois e o labor em folgas (FTS). É PROIBIDO inserir explicações, tabelas ou quadros sobre escalas 4x2, 6x2 ou qualquer jornada não trabalhada pelo obreiro.
- Para vigilantes, incluir a tese dos 10 minutos de descanso sentado a cada hora trabalhada (cláusulas 33ª/34ª da CCT).
- Dano moral: manter a fundamentação doutrinária padrão (inclusive a citação da Magistrada Martha Halfed Furtado) e INCORPORAR a narrativa concreta dos abusos relatados na entrevista (pagamentos por fora via PIX, ausência de descanso, desvio de função exaustivo, perseguição). Valor: exatamente 10x o último salário do reclamante.

E) CÁLCULO E ROL DE PEDIDOS:
- Quando o valor for estimativo, calcule um número proporcional e razoável (salário base × meses trabalhados × percentual aplicável).
- Pagamento por fora (folgas/FTS): apure o total e peça a INTEGRAÇÃO salarial com reflexos em DSR, aviso prévio, férias + 1/3, 13º e FGTS + 40%, sem repetir o principal em tópico isolado (evitar bis in idem).
- O valor da causa deve ser exatamente a soma dos itens do rol de pedidos.
- Honorários sucumbenciais: 15% de forma uniforme no tópico, no rol e no fecho.

G) TRAVAS ADICIONAIS (verificação final antes de entregar):
- AVISO PRÉVIO: em dispensa sem justa causa com data de saída definida, o aviso prévio é INDENIZADO (Lei 12.506/11). É PROIBIDO afirmar que o reclamante "cumpriu aviso prévio trabalhado" ou pedir a redução de 2 horas diárias quando a dispensa foi imotivada e imediata.
- VALE-TRANSPORTE: quando o valor não for informado na entrevista, adote o padrão de R$ 10,00 por dia (duas conduções de R$ 5,00) e explicite essa base de cálculo.

F) ENTREGA:
- Comece direto em "AO MM. JUÍZO DA VARA DO TRABALHO DE ...". Sem comentários, introduções ou narração de etapas.
- Garanta a concordância de gênero em todo o texto conforme o reclamante — EXCEÇÃO: a expressão "por seu advogado constituído" refere-se ao Dr. Fernando Andrade Vieira (sempre homem). Use SEMPRE "seu advogado" (masculino), mesmo quando a reclamante for mulher — NUNCA escreva "sua advogada".`;
