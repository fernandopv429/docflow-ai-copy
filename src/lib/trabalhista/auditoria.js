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
  const prompt = `Você é um auditor jurídico trabalhista. Verifique a MINUTA gerada quanto à COERÊNCIA factual e jurídica com o caso. NÃO reescreva a peça — apenas aponte problemas.

Checagens obrigatórias (padrão FAV — baseadas nos erros recorrentes do escritório):
1. GÊNERO: concordância uniforme com o sexo do reclamante em TODA a peça (sem "a reclamante/obreira/autora/dispensada" para homem, nem o inverso).
2. MODALIDADE de rescisão consistente em TODAS as seções (capítulo da causa + aviso prévio + verbas rescisórias + arts. 477/467 + pedidos).
3. HONORÁRIOS: percentual Único no corpo e no fecho (não pode 15% num lugar e 20% em outro).
4. 2ª RECLAMADA: se existe → qualificação + tópico Súmula 331 + pedido de subsidiária presentes; se não existe → todos ausentes.
5. ESCALA: 12x36 → descaracterização 12x36 + 10 min (cláusula 33ª) presentes; escala diferente (5x2/4x2) → NÃO incluir descaracterização 12x36.
6. NOTURNO: adicional noturno/hora reduzida só se houver jornada noturna (22h–5h).
7. CATEGORIA: vigilância vs. asseio governando cláusulas e teses (periculosidade/gratificação/10min/cláusula 33ª são de vigilância; porteiro/asseio usa cláusulas próprias).
8. CLÁUSULAS DA CCT: o número citado deve ser o MESMO no corpo e no pedido, e coerente com a CCT/ano aplicável.
9. COPY-PASTE: textos de gratificação/desvio/acúmulo não podem citar função diferente da do reclamante (ex.: "vigilante condutor" num porteiro).
10. AVISO PRÉVIO: dias coerentes com o tempo de serviço (Lei 12.506/11: 30 + 3/ano, máx. 90).
11. PROPORÇÕES: 13º e férias+1/3 coerentes com as datas (+ projeção do aviso); saldo de salário coerente.
12. DANO MORAL: ao menos 1 fato concreto do caso + valor = 10x a maior remuneração na função.
13. TESE ↔ PEDIDO: cada causa de pedir tem pedido correspondente e vice-versa; sem verba em DUPLICIDADE.
14. TESE SEM SUPORTE no relato (periculosidade sem exposição; HE sem sobrejornada; noturno sem jornada noturna).
15. VALOR DA CAUSA: soma dos pedidos = valor da causa; ≤ R$ 400.000,00; por extenso sem erro de digitação.
16. JURISPRUDÊNCIA pertinente à tese (ex.: acórdão de reversão de justa causa só em reversão).
17. MARCADORES [ ] pendentes; identidade do escritório correta (Dr. Fernando Andrade Vieira, OAB/SP 320.825).

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
