// Blocos condicionais {{#if TOKEN}}...{{/if}} (opcionalmente {{else}}).
// Usado tanto na exportação real (exportDocx.js) quanto na pré-visualização
// genérica de templates (GenerateDocument.jsx), para que blocos condicionais
// nunca apareçam como texto cru "{{#if ...}}" para o usuário.
export function applyConditionals(html, flags = {}) {
  if (!html) return html;
  const IF_RE = /\{\{#if\s+([A-Z0-9_]+)\}\}/;
  let out = html;
  let guard = 0;
  while (IF_RE.test(out) && guard < 500) {
    guard += 1;
    out = out.replace(/\{\{#if\s+([A-Z0-9_]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/, (m, key, whenTrue, whenFalse) => {
      if (/\{\{#if\s+[A-Z0-9_]+\}\}/.test(whenTrue)) return m; // aguarda a próxima passada (aninhado)
      return flags[key] ? whenTrue : (whenFalse || '');
    });
  }
  return out;
}

export function extractVariables(content) {
  if (!content) return [];
  const regex = /\{\{([A-Z0-9_]+)\}\}/g;
  const variables = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (!variables.find(v => v.name === name)) {
      variables.push({ name, description: '' });
    }
  }
  return variables;
}

export function highlightVariablesInHtml(html, values) {
  if (!html) return '';
  const flags = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (typeof v === 'boolean') flags[k] = v;
  }
  // Resolve blocos condicionais ANTES de destacar tokens — evita mostrar
  // "{{#if T_X}}" cru quando o template tem blocos condicionais (ex.: o
  // Modelo Padrão trabalhista, que varia conforme a modalidade de rescisão).
  let result = applyConditionals(html, flags);
  const regex = /\{\{([A-Z0-9_]+)\}\}/g;
  result = result.replace(regex, (match, name) => {
    const value = values?.[name];
    if (value !== undefined && value !== '') {
      return `<span class="var-filled">${value}</span>`;
    }
    return `<span class="var-pending">{{${name}}}</span>`;
  });
  return result;
}