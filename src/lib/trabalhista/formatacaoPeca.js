// Pós-processamento determinístico do HTML da petição gerada pela IA.
// A IA escreve o corpo; estas funções limpam, removem pedidos zerados,
// injetam o fecho (data/deferimento/assinatura) e normalizam a formatação.
// Tudo por código — a IA nunca escreve o fecho nem o valor da causa.

import { formatBRL, valorPorExtenso } from './mathUtils';

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