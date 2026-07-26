import { base44 } from '@/api/base44Client';
import { runtimeCacheKey, withRuntimeCache } from './runtimeCache';

// ============================================================
// Consultas oficiais determinísticas (sem IA): configuração das
// integrações + CNPJ (BrasilAPI) + CEP (ViaCEP) + DataJud (CNJ).
// ============================================================

// ---- Configuração das integrações (liga/desliga cada tool). Singleton. ----
export const CONFIG_INTEGRACOES_PADRAO = {
  cnpj_ativo: true,
  cep_ativo: true,
  datajud_ativo: false,
  datajud_tribunal: 'trt2',
  datajud_size: 5,
};

export async function carregarConfigIntegracoes() {
  return withRuntimeCache('config-integracoes', 'atual', async () => {
    try {
      const lista = await base44.entities.IntegracaoConfig.list('-updated_date', 1);
      return { ...CONFIG_INTEGRACOES_PADRAO, ...(lista?.[0] || {}) };
    } catch (e) {
      return { ...CONFIG_INTEGRACOES_PADRAO };
    }
  }, { ttlMs: 5 * 60 * 1000 });
}

// ---- CNPJ na Receita Federal (BrasilAPI) ----
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

export function extrairCnpjs(texto) {
  const encontrados = new Set();
  for (const m of (texto || '').matchAll(CNPJ_RE)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length === 14) encontrados.add(d);
  }
  return [...encontrados];
}

function formatarCnpj(digits) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export async function consultarCnpj(cnpj) {
  const digits = (cnpj || '').replace(/\D/g, '');
  if (digits.length !== 14) return { cnpj, erro: 'CNPJ inválido (precisa de 14 dígitos)' };
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
    if (resp.status === 404) return { cnpj: formatarCnpj(digits), erro: 'não encontrado na Receita' };
    if (!resp.ok) return { cnpj: formatarCnpj(digits), erro: `erro HTTP ${resp.status}` };
    const d = await resp.json();
    const cep = (d.cep || '').replace(/\D/g, '');
    const endereco = [
      `${d.descricao_tipo_de_logradouro || ''} ${d.logradouro || ''}`.trim(),
      d.numero,
      d.complemento,
      d.bairro,
      [d.municipio, d.uf].filter(Boolean).join('/'),
    ]
      .filter(Boolean)
      .join(', ');
    return {
      cnpj: formatarCnpj(digits),
      razao_social: d.razao_social || '',
      endereco,
      cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep,
      situacao: d.descricao_situacao_cadastral || '',
    };
  } catch (e) {
    return { cnpj: formatarCnpj(digits), erro: 'falha de rede ao consultar a Receita' };
  }
}

export async function enriquecerCnpjs(cnpjs) {
  const unicos = [
    ...new Set((cnpjs || []).map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 14)),
  ];
  if (!unicos.length) return [];
  const key = [...unicos].sort().join(',');
  return withRuntimeCache('cnpj', key, () => Promise.all(unicos.map(consultarCnpj)), { ttlMs: 60 * 60 * 1000 });
}

// ---- CEP (ViaCEP, com fallback BrasilAPI) ----
const CEP_LABEL_RE = /CEP:?\s*(\d{5}-?\d{3})/gi;
const CEP_DASH_RE = /\b\d{5}-\d{3}\b/g;

export function extrairCeps(texto) {
  const encontrados = new Set();
  const t = texto || '';
  for (const m of t.matchAll(CEP_LABEL_RE)) {
    const d = m[1].replace(/\D/g, '');
    if (d.length === 8) encontrados.add(d);
  }
  for (const m of t.matchAll(CEP_DASH_RE)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length === 8) encontrados.add(d);
  }
  return [...encontrados];
}

export async function consultarCep(cep) {
  const digits = (cep || '').replace(/\D/g, '');
  if (digits.length !== 8) return { cep, erro: 'CEP inválido (precisa de 8 dígitos)' };
  const fmt = `${digits.slice(0, 5)}-${digits.slice(5)}`;
  // 1) ViaCEP (traz município + código IBGE)
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (resp.ok) {
      const d = await resp.json();
      if (!d.erro) {
        return {
          cep: fmt,
          logradouro: d.logradouro || '',
          bairro: d.bairro || '',
          municipio: d.localidade || '',
          uf: d.uf || '',
          ibge: d.ibge || '',
        };
      }
    }
  } catch (e) {
    // segue para o fallback
  }
  // 2) Fallback BrasilAPI
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cep/v1/${digits}`);
    if (resp.ok) {
      const d = await resp.json();
      return {
        cep: fmt,
        logradouro: d.street || '',
        bairro: d.neighborhood || '',
        municipio: d.city || '',
        uf: d.state || '',
        ibge: '',
      };
    }
  } catch (e) {
    // ignora
  }
  return { cep: fmt, erro: 'não encontrado' };
}

export async function enriquecerCeps(ceps) {
  const unicos = [
    ...new Set((ceps || []).map((c) => (c || '').replace(/\D/g, '')).filter((d) => d.length === 8)),
  ];
  if (!unicos.length) return [];
  const key = [...unicos].sort().join(',');
  return withRuntimeCache('cep', key, () => Promise.all(unicos.map(consultarCep)), { ttlMs: 60 * 60 * 1000 });
}

// ---- DataJud (CNJ) — via função de backend (sem CORS no navegador) ----
export function montarTermosDatajud(attrs) {
  const termos = [...((attrs && attrs.teses) || [])];
  if (!termos.length && attrs?.funcao) termos.push(attrs.funcao);
  return [...new Set(termos.map((t) => (t || '').trim()).filter(Boolean))].slice(0, 4);
}

export async function consultarDatajud({ termo, tribunal = 'trt2', size = 5 }) {
  try {
    const resp = await base44.functions.invoke('datajud', { termo, tribunal, size });
    const data = resp?.data ?? resp;
    const hits = data?.hits || data?.processos || [];
    return { termo, hits: Array.isArray(hits) ? hits : [] };
  } catch (e) {
    return { termo, erro: 'indisponível' };
  }
}

export async function enriquecerDatajud(attrs, config) {
  if (!config?.datajud_ativo) return [];
  const termos = montarTermosDatajud(attrs);
  if (!termos.length) return [];
  const key = runtimeCacheKey({ termos, tribunal: config.datajud_tribunal, size: config.datajud_size });
  return withRuntimeCache('datajud', key, () => Promise.all(
    termos.map((termo) =>
      consultarDatajud({
        termo,
        tribunal: config.datajud_tribunal || 'trt2',
        size: config.datajud_size || 5,
      })
    )
  ), { ttlMs: 30 * 60 * 1000 });
}

// ---- CCT (cct-api / pgvector) — cláusulas por categoria + vigência ----
// Categoria da convenção a partir da função/sindicato do caso.
export function categoriaCct(caso = {}, attrs = {}) {
  const t = `${caso.funcao || attrs.funcao || ''} ${caso.sindicato || ''}`.toLowerCase();
  if (/vigilante|seevissp|sesvesp|segurança/.test(t)) return 'vigilancia';
  if (/asseio|limpeza|conserva|siemaco|seac/.test(t)) return 'asseio_conservacao';
  return 'terceirizados'; // porteiro / controlador de acesso / SINDEEPRES (padrão)
}

export async function consultarCct({ pergunta, categoria, data_fato, limite = 4 }) {
  try {
    const resp = await base44.functions.invoke('cct', { pergunta, categoria, data_fato, limite });
    const data = resp?.data ?? resp;
    return { pergunta, resultados: Array.isArray(data?.resultados) ? data.resultados : [], erro: data?.erro };
  } catch (e) {
    return { pergunta, resultados: [], erro: 'indisponível' };
  }
}

// Perguntas padrão para reunir as cláusulas mais usadas na peça.
const CCT_PERGUNTAS = [
  'adicional noturno e hora noturna reduzida',
  'auxílio alimentação / refeição e vale-transporte',
  'multa convencional por descumprimento de cláusula',
  'adicional de horas extras e intervalo intrajornada',
];

export async function enriquecerCct(caso, attrs, config) {
  if (!config?.cct_ativo) return null;
  const categoria = config.cct_categoria || categoriaCct(caso, attrs);
  const data_fato = caso?.data_rescisao || caso?.data_admissao || undefined;
  const key = runtimeCacheKey({ categoria, data_fato });
  return withRuntimeCache('cct', key, async () => {
    const buscas = await Promise.all(
      CCT_PERGUNTAS.map((pergunta) => consultarCct({ pergunta, categoria, data_fato, limite: 3 }))
    );
    // dedup por cláusula (clausula_ref + título da CCT)
    const vistos = new Set();
    const clausulas = [];
    for (const b of buscas) {
      for (const r of b.resultados) {
        const id = `${r.titulo}||${r.clausula_ref}`;
        if (vistos.has(id)) continue;
        vistos.add(id);
        clausulas.push(r);
      }
    }
    const top = clausulas[0] || null;
    return {
      categoria,
      data_fato,
      clausulas,
      meta: top ? {
        titulo: top.titulo,
        ano_base: top.ano_base,
        vigencia_inicio: top.vigencia_inicio,
        vigencia_fim: top.vigencia_fim,
        sindicato_laboral: top.sindicato_laboral,
        fonte_url: top.fonte_url,
      } : null,
    };
  }, { ttlMs: 30 * 60 * 1000 });
}
