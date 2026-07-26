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

Checagens obrigatórias (padrão FAV Advogados):
- Tese/pedido SEM suporte no relato (ex.: adicional noturno sem jornada noturna; periculosidade/insalubridade sem exposição relatada; horas extras sem alegação de sobrejornada).
- Verba pedida em DUPLICIDADE.
- Marcadores entre colchetes [ ] ainda pendentes (dados que faltam preencher).
- Modalidade de rescisão incompatível com os pedidos.
- Valor da causa acima de R$ 400.000,00 (teto).
- Cada causa de pedir tem PEDIDO correspondente em "DOS PEDIDOS", e vice-versa.
- Dano moral: presença de ao menos UM elemento concreto do caso e valor = 10x a maior remuneração na função.
- Ausência de tópico obrigatório (ex.: responsabilidade subsidiária/Súm. 331 quando há tomadora).
- Concordância de GÊNERO coerente com o(a) reclamante (o/a, dispensado/a, obreiro/a etc.).
- Conferência de CNPJ, endereço, competência (art. 651) e CCT/vigência.

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
