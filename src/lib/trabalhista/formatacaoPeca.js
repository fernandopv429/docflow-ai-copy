// Pós-processamento determinístico do HTML da petição gerada pela IA.
// A IA escreve o corpo; estas funções limpam, removem pedidos zerados,
// injetam o fecho (data/deferimento/assinatura) e normalizam a formatação.
// Tudo por código — a IA nunca escreve o fecho nem o valor da causa.

import { formatBRL, valorPorExtenso, round2 } from './mathUtils';

// Extrai um "esqueleto" textual do HTML do modelo padrão, para o prompt da IA.
// Mantém a estrutura (títulos, parágrafos, listas) como texto legível, sem tags
// de formatação, para a IA seguir a ordem e o texto-padrão do escritório.
export function esqueletoDoModelo(html) {
  if (!html) return '';
  let t = String(html);
  // Converte headings em marcadores textuais preservando o conteúdo
  t = t.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  t = t.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  t = t.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  t = t.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  t = t.replace(/<\/p>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  // Remove todas as tags restantes
  t = t.replace(/<[^>]+>/g, '');
  // Decodifica entidades básicas
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  // Compacta espaços e quebras excessivos
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

// Remove pedidos (li) com valor zerado, "a apurar" ou colchetes de rascunho.
// Evita que o rol de pedidos saia com linhas infladas ou sem valor definido.
export function removerPedidosZerados(html) {
  if (!html) return html;
  let t = String(html);
  // Remove <li> cujo conteúdo indique valor zerado/ausente
  t = t.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (match, conteudo) => {
      const limpo = String(conteudo).replace(/<[^>]+>/g, '').trim();
      if (/R\$\s*0+,00/i.test(limpo)) return '';
      if (/^\s*\[.*a\s+apur.*\]\s*$/i.test(limpo)) return '';
      if (/^\s*\[.*rascunho.*\]\s*$/i.test(limpo)) return '';
      return match;
    }
  );
  // Limpa <ul> que ficaram vazias após a remoção
  t = t.replace(/<ul[^>]*>\s*<\/ul>/gi, '');
  return t;
}

// Constrói o valor da causa por extenso e o fecho padrão do escritório.
// A IA NÃO escreve o fecho — esta função injeta deterministicamente.
export function aplicarFechoDeterministico(html, { valorCausa } = {}) {
  if (!html) return html;
  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const valorTxt = valorCausa != null && !isNaN(valorCausa)
    ? `${formatBRL(valorCausa)} (${valorPorExtenso(valorCausa)})`
    : '[VALOR DA CAUSA]';
  const fecho = [
    `<p>Dá-se à causa o valor de <strong>${valorTxt}</strong>.</p>`,
    `<p>Pede deferimento.</p>`,
    `<p>São Paulo, ${hoje}.</p>`,
    `<p><strong>FAV Advogados</strong><br/>Dr. Fernando Andrade Vieira — OAB/SP nº 320.825</p>`,
  ].join('\n');
  // Garante separação do corpo antes do fecho
  return `${String(html).replace(/\s+$/, '')}\n${fecho}`;
}

// Normaliza o HTML final: envolve o corpo em um container de documento e
// garante que parágrafos soltos fiquem dentro de <p>. Aplicado após o fecho.
export function aplicarFormatacaoPadrao(html) {
  if (!html) return html;
  let t = String(html).trim();
  // Envolve o conteúdo em um container de documento (estilo do escritório)
  return `<div class="legal-document-body">\n${t}\n</div>`;
}

// Converte "70.368,67" -> 70368.67
function parseBRL(s) {
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Soma os R$ EFETIVAMENTE exibidos no rol "DOS PEDIDOS" do HTML da IA.
// O fecho (valor da causa) passa a ser exatamente a soma do que está
// mostrado no rol — nunca diverge por erro de digitação da IA no array
// <!--PEDIDOS_VALORES:[...]-->, que vira apenas fallback.
export function somarRolPedidos(html) {
  if (!html) return null;
  const m = /DOS\s*PEDIDOS/i.exec(html);
  if (!m) return null;
  let rol = html.slice(m.index);
  const f = /D[aá]-se\s+(?:à|a)\s+causa|REQUERIMENTOS|<p>\s*Pede\s+deferimento/i.exec(rol);
  if (f) rol = rol.slice(0, f.index);
  const totais = [...rol.matchAll(/VALOR\s*TOTAL\s*(?:DO\s*ITEM)?\s*:?\s*R\$\s*([\d.]+,\d{2})/gi)].map((x) => x[1]);
  let valores;
  if (totais.length >= 2) {
    valores = totais;
  } else {
    valores = [...rol.matchAll(/R\$\s*([\d.]+,\d{2})/gi)].map((x) => x[1]);
  }
  if (!valores.length) return null;
  return round2(valores.reduce((s, v) => s + parseBRL(v), 0));
}

function escRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Garante o e-mail pessoal do reclamante no tópico "Juízo 100% Digital".
function garantirEmailJuizoDigital(html, email) {
  const esc = escRegex(email);
  const m = /JU[ÍI]ZO\s*100\s*%?\s*DIGITAL/i.exec(html);
  if (!m) return html;
  const trecho = html.slice(m.index, m.index + 1500);
  if (new RegExp(esc, 'i').test(trecho)) return html;
  const after = html.slice(m.index);
  const pm = /<\/p>/i.exec(after);
  if (!pm) return html;
  const idx = m.index + pm.index + 4;
  const inj = `<p>O autor informa seu endereço de e-mail pessoal ${email}, devendo eventuais comunicações formais ser encaminhadas também ao patrono no e-mail constante ao final.</p>`;
  return html.slice(0, idx) + inj + html.slice(idx);
}

// Injeta deterministicamente o e-mail pessoal do reclamante no preâmbulo
// e no Juízo 100% Digital quando a IA o omitiu. O e-mail vem da extração
// determinística (extrairDeterministico) — não depende da IA citá-lo.
export function injetarEmailPessoal(html, email) {
  if (!html || !email) return html;
  const esc = escRegex(email);
  let t = String(html);
  const presente = new RegExp(esc, 'i').test(t.slice(0, 3000));
  if (!presente) {
    t = t.replace(/(por\s+seu\s+advogado\s+constitu[íi]do)/i, `com endereço de e-mail pessoal: ${email}, $1`);
  }
  return garantirEmailJuizoDigital(t, email);
}

// Corrige flexões femininas residuais para reclamante MASCULINO. Rede de
// segurança sobre o texto da IA, que eventualmente desobedece à regra STRICT
// de gênero do prompt. Só toca palavras que se referem ao reclamante
// (reclamante/obreira/autora) — nunca "reclamada" (a empresa), que permanece
// feminina. Aplicar apenas quando recl_genero === 'M'.
export function flexionarGeneroMasculino(html) {
  if (!html) return html;
  let t = String(html);
  t = t.replace(/\ba\s+reclamante\b/gi, 'o reclamante');
  t = t.replace(/\bA\s+reclamante\b/g, 'O reclamante');
  t = t.replace(/\bà\s+reclamante\b/gi, 'ao reclamante');
  t = t.replace(/\bÀ\s+reclamante\b/g, 'Ao reclamante');
  t = t.replace(/\bda\s+reclamante\b/gi, 'do reclamante');
  t = t.replace(/\bDa\s+reclamante\b/g, 'Do reclamante');
  t = t.replace(/\bpela\s+reclamante\b/gi, 'pelo reclamante');
  t = t.replace(/\bPela\s+reclamante\b/g, 'Pelo reclamante');
  t = t.replace(/\bna\s+reclamante\b/gi, 'no reclamante');
  t = t.replace(/\bNa\s+reclamante\b/g, 'No reclamante');
  t = t.replace(/\ba\s+obreira\b/gi, 'o obreiro');
  t = t.replace(/\bA\s+obreira\b/g, 'O obreiro');
  t = t.replace(/\bà\s+obreira\b/gi, 'ao obreiro');
  t = t.replace(/\bda\s+obreira\b/gi, 'do obreiro');
  t = t.replace(/\bpela\s+obreira\b/gi, 'pelo obreiro');
  t = t.replace(/\ba\s+autora\b/gi, 'o autor');
  t = t.replace(/\bA\s+autora\b/g, 'O autor');
  t = t.replace(/\bda\s+autora\b/gi, 'do autor');
  // Erros residuais específicos reportados (Súmula 331 / art. 71)
  t = t.replace(/\bdiretamente\s+ligada\b/gi, 'diretamente ligado');
  t = t.replace(/\bligada\s+à\s+tomadora\b/gi, 'ligado à tomadora');
  t = t.replace(/\brendê-la\b/gi, 'rendê-lo');
  t = t.replace(/\brend[aá]-la\b/gi, 'rendê-lo');
  t = t.replace(/\bbrasileiro\(a\)/gi, 'brasileiro');
  return t;
}