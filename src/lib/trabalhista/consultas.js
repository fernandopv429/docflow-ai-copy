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
  cct_ativo: true,
  cct_categoria: '',
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
    const resp = await base44.functions.invoke('cnpj', { cnpj: digits });
    const d = resp?.data ?? resp;
    return d || { cnpj: formatarCnpj(digits), erro: 'sem retorno da função' };
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
  try {
    const resp = await base44.functions.invoke('cep', { cep: digits });
    const d = resp?.data ?? resp;
    return d || { cep: fmt, erro: 'sem retorno da função' };
  } catch (e) {
    return { cep: fmt, erro: 'falha de rede ao consultar o CEP' };
  }
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

export async function consultarCct({ pergunta, categoria, data_fato, municipio, uf, limite = 4 }) {
  try {
    const resp = await base44.functions.invoke('cct', { pergunta, categoria, data_fato, municipio, uf, limite });
    const data = resp?.data ?? resp;
    return { pergunta, resultados: Array.isArray(data?.resultados) ? data.resultados : [], erro: data?.erro };
  } catch (e) {
    return { pergunta, resultados: [], erro: 'indisponível' };
  }
}

// Perguntas base (temas presentes em praticamente toda petição) + condicionais
// (só entram quando a tese existe no caso, para trazer cláusula REAL da base).
const CCT_PERGUNTAS_BASE = [
  'piso salarial / salário normativo da categoria',
  'adicional noturno e hora noturna reduzida',
  'auxílio alimentação / refeição e vale-transporte',
  'multa convencional por descumprimento de cláusula',
  'adicional de horas extras e intervalo intrajornada',
];

const CCT_PERGUNTAS_CONDICIONAIS = [
  [/desvio de fun/i, 'desvio de função e a multa convencional correspondente'],
  [/ac[uú]mulo de fun/i, 'acúmulo de função e a multa convencional correspondente'],
  [/periculos/i, 'adicional de periculosidade e sua integração nas horas extras'],
  [/insalubr/i, 'adicional de insalubridade'],
  [/10 minutos|descanso sentad/i, 'os 10 minutos de descanso sentado durante a jornada'],
  [/12x36|escala|jornada|hora[s]? extra/i, 'compensação de jornada, escala 12x36 e prorrogação'],
  [/folga|dsr|descanso semanal|feriado/i, 'trabalho em folgas, feriados e descanso semanal remunerado'],
  [/dano moral|ass[eé]dio/i, 'garantias e direitos do trabalhador previstos na convenção'],
  [/gratifica[çc][aã]o|condutor|motorista/i, 'gratificação de função do condutor de veículo'],
  [/assiduidade/i, 'prêmio de assiduidade e seu valor previsto em convenção'],
];

export function perguntasCct(caso = {}, attrs = {}) {
  const contexto = [
    ...(attrs.teses || []),
    caso.acumulo_funcao,
    caso.funcao,
    caso.jornada_horario,
    caso.tem_desvio && 'desvio de função',
    caso.tem_acumulo && 'acúmulo de função',
    caso.tem_periculosidade && 'periculosidade',
    caso.tem_insalubridade && 'insalubridade',
    caso.tem_adic_noturno && 'adicional noturno',
    caso.tem_ft && 'folgas trabalhadas',
    caso.tem_dano_moral && 'dano moral',
    caso.tem_assiduidade && 'assiduidade',
  ]
    .filter(Boolean)
    .join(' ');
  const condicionais = CCT_PERGUNTAS_CONDICIONAIS.filter(([re]) => re.test(contexto)).map(([, p]) => p);
  return [...new Set([...CCT_PERGUNTAS_BASE, ...condicionais])];
}

// Município onde o reclamante prestava serviços — define a base territorial
// da CCT. Extraído do endereço de prestação (formato BR: "..., Cidade - UF, CEP").
function municipioDeLocal(local) {
  if (!local) return '';
  const s = String(local).replace(/\d{5}-?\d{3}/g, '').trim();
  const m = s.match(/([A-ZÀ-Ý][A-ZÀ-Ý\s'.-]*?)\s*-\s*([A-Z]{2})\b/i);
  return m ? m[1].trim().replace(/[.,;]+$/, '') : '';
}

export async function enriquecerCct(caso, attrs, config, local = {}) {
  if (!config?.cct_ativo) return null;
  const categoria = config.cct_categoria || categoriaCct(caso, attrs);
  const data_fato = caso?.data_rescisao || caso?.data_admissao || undefined;
  const municipio = local.municipio || municipioDeLocal(caso?.local_prestacao) || caso?.comarca || undefined;
  const uf = local.uf || undefined;
  const perguntas = perguntasCct(caso, attrs);
  const key = runtimeCacheKey({ categoria, data_fato, municipio, uf, perguntas });
  return withRuntimeCache('cct', key, async () => {
    const buscas = await Promise.all(
      perguntas.map((pergunta) => consultarCct({ pergunta, categoria, data_fato, municipio, uf, limite: 3 }))
    );
    // dedup por cláusula (título da CCT + referência da cláusula)
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
      municipio,
      uf,
      perguntas,
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

// ============================================================
// Extrai o piso salarial da CCT aplicável quando o salário do
// reclamante não foi informado na entrevista. Procura nas cláusulas
// por menções a "piso", "salário normativo", "salário base" e
// extrai o valor monetário. Tem fallback empírico por categoria/ano.
// ============================================================
const PISOS_FALLBACK = {
  // vigilancia SP — atualizados periodicamente conforme CCT SINDESEG/SINDEEPRES
  vigilante_2025: 2127.66,
  vigilante_2026: 2271.74,
  // porteiro / controlador (SINDEEPRES) SP
  porteiro_2025: 1699.23,
  porteiro_2026: 1805.00,
  // asseio/conservação SP
  asseio_2025: 1699.23,
  asseio_2026: 1805.00,
};

export function extrairPisoCct(dadosCct, funcao = '') {
  if (!dadosCct?.clausulas?.length) return null;
  const PADROES_PISO = /piso\s*salarial|sal[áa]rio\s*normativo|sal[áa]rio\s*base|sal[áa]rio\s*m[íi]nimo\s*(?:da\s*categoria|convencional)/i;
  for (const c of dadosCct.clausulas) {
    const texto = [c.ementa, c.texto, c.conteudo, c.clausula_titulo, c.clausula_ref].filter(Boolean).join(' ');
    if (!PADROES_PISO.test(texto)) continue;
    // Extrai o valor: "R$ 2.271,74" ou "2.271,74" ou "2271,74"
    const m = texto.match(/R\$\s*([\d.]+,\d{2})/i) || texto.match(/\b(\d{3,4}[\.,]\d{2})\b/);
    if (m) {
      const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      if (Number.isFinite(v) && v > 500 && v < 20000) return v;
    }
  }
  // Fallback empírico por categoria/ano
  const ano = dadosCct.meta?.ano_base ? String(dadosCct.meta.ano_base) : String(new Date().getFullYear());
  const cat = dadosCct.categoria || categoriaCct({ funcao }, {});
  const ehVig = /vigilante|vigil/i.test(funcao || '');
  const chave = ehVig ? `vigilante_${ano}` : `${cat}_${ano}`;
  if (PISOS_FALLBACK[chave]) return PISOS_FALLBACK[chave];
  return null;
}