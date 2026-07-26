import { base44 } from '@/api/base44Client';
import { withRuntimeCache } from './runtimeCache';

// ============================================================
// Matching determinístico: pontua cada modelo de referência
// contra os atributos extraídos da entrevista.
// ============================================================
const norm = (s) =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function pontuarModelo(modelo, attrs = {}) {
  let score = 0;
  const motivos = [];
  if (attrs.tipo_dispensa && modelo.tipo_dispensa === attrs.tipo_dispensa) {
    score += 5;
    motivos.push('Mesma modalidade de rescisão');
  }
  if (attrs.funcao && modelo.funcao) {
    const a = norm(attrs.funcao);
    const m = norm(modelo.funcao);
    const mesmaFuncao =
      (a && (m.includes(a) || a.includes(m))) ||
      (a.includes('controlador') && m.includes('controlador')) ||
      (a.includes('porteiro') && m.includes('porteiro'));
    if (mesmaFuncao) {
      score += 2;
      motivos.push('Mesma função');
    }
  }
  if (attrs.rito && modelo.rito === attrs.rito) {
    score += 1;
    motivos.push('Mesmo rito');
  }
  if (attrs.tem_tomadora === true && modelo.tem_tomadora === true) {
    score += 2;
    motivos.push('Tem tomadora (Súm. 331 TST)');
  }
  const modeloTeses = (modelo.teses || []).map(norm);
  for (const t of attrs.teses || []) {
    const nt = norm(t);
    if (nt && modeloTeses.some((x) => x.includes(nt) || nt.includes(x))) {
      score += 1;
      motivos.push(`Tese: ${t}`);
    }
  }
  return { score, motivos };
}

export function rankearModelos(modelos, attrs) {
  return (modelos || [])
    .map((modelo) => ({ modelo, ...pontuarModelo(modelo, attrs) }))
    .sort((a, b) => b.score - a.score);
}

export async function listarModelosAtivos() {
  return withRuntimeCache('modelos-ativos', 'lista', async () => {
    const todos = await base44.entities.ModeloReferencia.list('-updated_date', 100);
    return todos.filter((m) => m.ativo !== false);
  }, { ttlMs: 5 * 60 * 1000 });
}
