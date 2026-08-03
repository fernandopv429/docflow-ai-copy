import { base44 } from '@/api/base44Client';

// Chamada ao LLM com limite de tempo por tentativa. Sem isso, uma chamada
// que fica pendurada no gateway trava a geração para sempre.
function comTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: o serviço de IA não respondeu a tempo')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// Chamada ao LLM com retentativa automática para erros transitórios (502/503/504/timeout).
export async function invokeLLMComRetry(req, { tentativas = 3, timeoutMs = 240000, onRetry } = {}) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await comTimeout(base44.integrations.Core.InvokeLLM(req), timeoutMs);
    } catch (err) {
      ultimoErro = err;
      const status = err?.response?.status || err?.status;
      const transitorio = [502, 503, 504].includes(status) || /timeout|network/i.test(err?.message || '');
      if (!transitorio || i === tentativas - 1) throw err;
      onRetry?.(i + 1);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw ultimoErro;
}
