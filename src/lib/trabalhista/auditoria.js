import { base44 } from '@/api/base44Client';
import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';
import { traceAiCall } from '@/lib/sessionTrace';

// ============================================================
// Auditoria de coerência jurídica: o LLM audita a peça gerada
// (dados/flags + texto resolvido) e aponta problemas — NÃO reescreve.
// ============================================================
const COERENCIA_SCHEMA = {
  type: 'object',
  required: ['status', 'alertas'],
  properties: {
    status: { type: 'string', enum: ['aprovado', 'revisar', 'bloqueado'] },
    alertas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severidade: { type: 'string', enum: ['BLOQUEANTE', 'ATENCAO', 'INFO'] },
          descricao: { type: 'string' },
          sugestao: { type: 'string' },
        },
      },
    },
  },
};

export async function verificarCoerencia({ texto, caso, dados, documentoTexto }) {
  const prompt = `Você é um auditor jurídico trabalhista. Verifique a MINUTA gerada quanto à COERÊNCIA factual e jurídica com o caso, à PADRONIZAÇÃO obrigatória do escritório e às PROIBIÇÕES de redação. NÃO reescreva a peça — apenas aponte problemas.

=== A. PADRÃO OBRIGATÓRIO (100% das peças) ===
A1. ESTRUTURA FIXA — a petição deve conter, nesta ORDEM: (i) endereçamento e fixação da competência territorial pelo art. 651 da CLT (local da prestação); (ii) qualificação completa do reclamante e de todas as reclamadas (prestadora e tomadora); (iii) capítulo de PRELIMINARES (competência local; não limitação ao valor da causa — art. 840, §1º CLT e IN 41/2018 TST; opção pelo juízo 100% digital; requerimento de prazo para emenda — arts. 317-321 CPC; justiça gratuita — art. 98 CPC c/c art. 790, §§3º e 4º CLT); (iv) DO CONTRATO DE TRABALHO (admissão, demissão, função, local, último salário, motivo da rescisão); (v) MÉRITO em capítulos temáticos; (vi) ROL DE PEDIDOS com memória descritiva e valores estimativos; (vii) ENCERRAMENTO (provas, recolhimentos INSS/IR, ofícios, OAB p/ intimações, valor da causa). Aponte qualquer seção ausente ou fora de ordem.
A2. TESES PADRÃO AUTOMÁTICAS:
  - TOMADORA: se há 2ª reclamada → deve haver tese de responsabilidade subsidiária (Súmula 331, IV, TST — culpa in vigilando/in eligendo) + pedido correspondente. Se não há tomadora, a tese deve estar ausente.
  - DESCARACTERIZAÇÃO 12x36: se escala 12x36 E houver extrapolação habitual, minutos antecedentes/sucedentes ou labor em folgas → deve haver descaracterização com Súmula 85 do TST (HEs além da 8ª diária e 44ª semanal). Sem esse cenário, NÃO incluir a descaracterização.
  - ACÚMULO/DESVIO DE FUNÇÃO: deve aplicar a multa/sanção prevista na CCT da categoria do reclamante (não valor fixo genérico).
  - INTERVALO INTRAJORNADA: se houver intervalo suprimido/reduzido → pleitear a hora cheia (ou saldo suprimido) COM adicional convencional (mínimo de 60% se previsto na CCT da categoria).
  - REFLEXOS COMPLETOS: TODOS os pedidos salariais/extraordinários (HE, folgas, acúmulo, desvio, assiduidade, integração por fora, etc.) devem trazer reflexos em DSR, aviso prévio, 13º salário, férias + 1/3 e FGTS + 40%. Aponte cada verba sem o conjunto completo de reflexos.

=== B. PROIBIÇÕES DE REDAÇÃO (erros a impedir) ===
B1. INCOERÊNCIA DE HORÁRIOS: proibido citar um horário no capítulo de jornada e outro no capítulo de adicional noturno. A jornada deve partir de uma MATRIZ ÚNICA de horários. Aponte qualquer divergência interna de horários.
B2. SUBDIMENSIONAMENTO DE FOLGAS: proibido confundir a diária por folga com o total mensal. O valor unitário deve ser multiplicado pela média de folgas/mês (e pelos meses). Aponte se a memória de cálculo de folgas usar só o valor unitário.
B3. OMISSÃO DE FATOS RELATADOS: cada fato listado em "fatos_narrados" deve ter capítulo correspondente na minuta. Aponte TODOS os fatos narrados sem capítulo (ex.: desconto indevido de consignado mencionado mas sem capítulo). Use a lista fatos_narrados do caso.
B4. CAPÍTULO SEM SUPORTE: proibido incluir capítulo genérico quando o fato correspondente NÃO foi narrado/marcado na entrevista (ex.: insalubridade/penção se marcado "Não"; periculosidade sem exposição; HE sem sobrejornada; noturno sem jornada noturna).
B5. GRAFIA DE MUNICÍPIO: conferir nomes de cidades — "Itapecerica da Serra/SP" (nunca "Itapecerica da Terra"). Aponte qualquer grafia evidentemente errada de município.
B6. FERIADOS ANTERIORES À ADMISSÃO: a seção de horas extras 100% (feriados) só pode listar feriados DENTRO do período contratual. Se a admissão for posterior a 01/01, Carnaval ou Páscoa do mesmo ano, esses feriados NÃO podem constar. Aponte feriados listados antes da data de admissão.
B7. VALOR DA CAUSA UNIFORME: o valor da causa no ROL de pedidos deve ser IGUAL ao do encerramento ("Dá-se à presente o valor de..."). Aponte qualquer divergência entre os dois valores.

=== C. CHECAGENS FAV (erros recorrentes do escritório) ===
C1. GÊNERO: concordância uniforme com o sexo do reclamante em TODA a peça (sem "a reclamante/obreira/autora" para homem, nem o inverso).
C2. MODALIDADE de rescisão consistente em TODAS as seções (capítulo da causa + aviso prévio + verbas rescisórias + arts. 477/467 + pedidos).
C3. HONORÁRIOS: percentual ÚNICO no corpo e no fecho.
C4. 2ª RECLAMADA: existe → qualificação + Súmula 331 + pedido de subsidiária; não existe → tudo ausente.
C5. CATEGORIA: vigilância vs. asseio governando cláusulas e teses (periculosidade/gratificação/10min/cláusula 33ª são de vigilância; porteiro/asseio usa cláusulas próprias).
C6. CLÁUSULAS DA CCT: o número citado deve ser o MESMO no corpo e no pedido, coerente com a CCT/ano aplicável.
C7. COPY-PASTE: textos de gratificação/desvio/acúmulo não podem citar função diferente da do reclamante.
C8. AVISO PRÉVIO: dias coerentes com o tempo de serviço (Lei 12.506/11: 30 + 3/ano, máx. 90).
C9. PROPORÇÕES: 13º e férias+1/3 coerentes com as datas (+ projeção do aviso); saldo de salário coerente.
C10. DANO MORAL: ao menos 1 fato concreto do caso + valor = 10x a maior remuneração na função.
C11. TESE ↔ PEDIDO: cada causa de pedir tem pedido correspondente e vice-versa; sem verba em duplicidade.
C12. VALOR DA CAUSA: soma dos pedidos = valor da causa; ≤ R$ 400.000,00; por extenso sem erro de digitação.
C13. JURISPRUDÊNCIA pertinente à tese (ex.: acórdão de reversão de justa causa só em reversão).
C14. MARCADORES [ ] pendentes; identidade do escritório correta (Dr. Fernando Andrade Vieira, OAB/SP 320.825).
C15. HONORÁRIOS SUCUMBENCIAIS: a fundamentação correta é o ARTIGO 791-A DA CLT (Lei 13.467/2017). A Súmula 425 do TST versa sobre JUS POSTULANDI (justiça gratuita/parte que se defende sem advogado) — NÃO serve de fundamento para honorários. Aponte se a peça citar "Súmula 425" para honorários no corpo ou no fecho.
C16. FRAÇÕES COM AVISO PRÉVIO: o 13º proporcional e as férias + 1/3 devem usar a data de rescisão PROJETADA pelo aviso prévio indenizado (rescisão + 30 dias, Lei 12.506/2011). Para admissão em meados do ano, o 13º NUNCA pode ser 12/12 (não houve trabalho de janeiro a março); férias NUNCA pode ser 11/12 se o contrato durou menos de 11 meses. Aponte frações incompatíveis com as datas do contrato + projeção do aviso.
C17. AUXÍLIO-ALIMENTAÇÃO ZERO: se a tese de auxílio-alimentação nas folgas estiver ativa, o valor unitário diário da CCT NÃO pode ser R$ 0,00. Aponte "R$ 0,00" no pedido de auxílio-alimentação — deve constar o valor diário estipulado pela CCT da categoria.
C18. MULTA CONVENCIONAL SEM CLÁUSULA: no tópico das multas, deve constar o NÚMERO da cláusula da CCT que prevê a penalidade (ex.: "Cláusula 64ª"). Aponte "multa da cláusula da CCT" sem numeração — identificar a cláusula específica violada.
C19. DUPLICAÇÃO TEXTUAL: aponte palavras/frases duplicadas consecutivamente (ex.: "imputa-lhe imputa-lhe") — artifact de copy-paste ou docxtemplater.

=== D. TÉCNICA DOS 4 BLOCOS (qualidade de cada capítulo de mérito) ===
Cada capítulo de mérito deve conter, na ordem: (1) NARRATIVA dos fatos fiel ao depoimento; (2) ENQUADRAMENTO legal/normativo (CLT + CCT da categoria, com cláusula/ano); (3) JURISPRUDÊNCIA/doutrina (Súmulas TST pertinentes); (4) CONCLUSÃO e PEDIDO direto COM reflexos explícitos. Aponte capítulos que pulam blocos, sobretudo a ausência de reflexos no pedido de fechamento.

Classifique cada alerta: BLOQUEANTE (erro grave), ATENCAO (revisar) ou INFO. Defina "status": "bloqueado" se houver BLOQUEANTE; "revisar" se houver ATENCAO; senão "aprovado".

DADOS DO CASO (estruturado): ${JSON.stringify(caso || {})}
DADOS/FLAGS DO TEMPLATE (o que foi ligado na peça): ${JSON.stringify(dados || {})}
RELATO/ENTREVISTA: """${texto || ''}"""
${documentoTexto ? `MINUTA GERADA (texto): """${documentoTexto}"""` : ''}

Responda APENAS com o objeto JSON.`;
  const request = {
    prompt,
    model: 'claude_sonnet_4_6',
    response_json_schema: COERENCIA_SCHEMA,
  };
  return withRuntimeCache('auditoria-coerencia', runtimeCacheKey(prompt), () =>
    traceAiCall('Auditoria de coerência', request, () => base44.integrations.Core.InvokeLLM(request))
  );
}