import { sessionTrace } from '@/lib/sessionTrace';

const buckets = new Map();

// Invalida um namespace inteiro (sem key) ou uma chave específica.
export function invalidateRuntimeCache(namespace, key) {
  const bucket = buckets.get(namespace);
  if (!bucket) return;
  if (key === undefined) bucket.clear();
  else bucket.delete(key);
}

export function runtimeCacheKey(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export async function withRuntimeCache(namespace, key, loader, options = {}) {
  const { ttlMs = 10 * 60 * 1000, onHit, force = false } = options;
  if (!buckets.has(namespace)) buckets.set(namespace, new Map());
  const bucket = buckets.get(namespace);
  const cached = bucket.get(key);

  if (!force && cached && Date.now() - cached.createdAt < ttlMs) {
    onHit?.();
    sessionTrace({
      category: 'Cache', title: `Cache reutilizado: ${namespace}`, status: 'HIT', durationMs: 0,
      details: { chave: key, idade_ms: Date.now() - cached.createdAt, validade_ms: ttlMs },
    });
    return cached.value;
  }

  const startedAt = Date.now();
  sessionTrace({
    category: 'Cache', title: `Nova execução: ${namespace}`, status: 'MISS',
    details: { chave: key, validade_ms: ttlMs },
  });
  const value = Promise.resolve().then(loader);
  bucket.set(key, { createdAt: Date.now(), value });
  try {
    const result = await value;
    sessionTrace({
      category: 'Cache', title: `Resultado armazenado: ${namespace}`, status: 'SALVO',
      durationMs: Date.now() - startedAt, details: { chave: key },
    });
    return result;
  } catch (error) {
    bucket.delete(key);
    sessionTrace({
      level: 'error', category: 'Cache', title: `Falha removida do cache: ${namespace}`, status: 'ERRO',
      durationMs: Date.now() - startedAt, details: { chave: key, mensagem: error.message, stack: error.stack },
    });
    throw error;
  }
}