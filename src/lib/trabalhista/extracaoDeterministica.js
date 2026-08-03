// ============================================================
// Extração determinística (regex) dos campos básicos da entrevista.
// Usada como FALLBACK quando o parser da IA devolve o caso vazio —
// garante que nome, CPF, RG, datas, salário, CNPJs etc. preencham o
// template mesmo se a IA falhar ou devolver embrulhado.
// A IA continua prioritária; isto só preenche lacunas.
// ============================================================

const ehVazio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function limparDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

// Converte "14/04/2025" -> "2025-04-14"
function paraIsoData(s) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function comoNumero(s) {
  const limpo = String(s || '').replace(/R\$\s*/gi, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : undefined;
}

function matchAny(texto, padroes) {
  const lista = Array.isArray(padroes) ? padroes : [padroes];
  for (const re of lista) {
    const m = re.exec(texto);
    if (m) return m[1];
  }
  return undefined;
}

export function extrairDeterministico(texto) {
  if (!texto || !texto.trim()) return {};
  const t = texto;
  const caso = {};

  // Nome do reclamante — texto antes de "brasileiro(a)"
  const nome = matchAny(t, [
    /^([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ\s]+?),\s*brasileir[oa]/,
    /^([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ\s]+?),\s*portador/,
  ]);
  if (nome) caso.recl_nome = nome.trim();

  // Estado civil — após "brasileiro(a)," vem o estado civil
  const estCiv = matchAny(t, /brasileir[oa](?:\s*\(a\))?\s*,\s*([a-zçãáéíóú]+),/i);
  if (estCiv) caso.recl_estado_civil = estCiv.trim().toLowerCase();

  // CPF — primeiro CPF formatado da entrevista (do reclamante)
  const cpfMatch = /\b(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})\b/.exec(t);
  if (cpfMatch) caso.recl_cpf = limparDigitos(cpfMatch[1]);

  // RG
  const rg = matchAny(t, /RG[:\s]*(?:n[ºo]?\.?\s*)?(\d+)/i);
  if (rg) caso.recl_rg = limparDigitos(rg);

  // PIS
  const pis = matchAny(t, /PIS[:\s]*(?:n[ºo]?\.?\s*)?([\d.-]+)/i);
  if (pis) caso.recl_pis = limparDigitos(pis);

  // CTPS e Série (separados)
  const ctps = matchAny(t, /CTPS[:\s]*(?:n[ºo]?\.?\s*)?(\d+)/i);
  if (ctps) caso.recl_ctps = limparDigitos(ctps);
  // "n[ºo]?" opcional: entrevistas costumam escrever "serie: 25795" sem o "nº",
  // e a versão anterior desta regex exigia o "n" literal — nunca casava nesse formato
  // e o RECL_SERIE saía como "[SÉRIE]" (colchete não preenchido) na minuta final.
  const serie = matchAny(t, /s[ée]rie[:\s]*(?:n[ºo]?\.?\s*)?(\d+)/i);
  if (serie) caso.recl_serie = limparDigitos(serie);

  // Nascimento
  const nasc = matchAny(t, /nascid[oa]\s+em\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (nasc) caso.recl_nascimento = paraIsoData(nasc);

  // Filiação
  const fil = matchAny(t, /filh[oa]\s+de\s+(.+?)(?:,\s*residente|,\s*com\s*correio|,\s*domiciliad)/i);
  if (fil) caso.recl_filiacao = fil.trim();

  // Endereço do reclamante — entre "residente e domiciliado na" e "CEP"
  const end = matchAny(t, /(?:residente|domiciliad[oa])\s+(?:e\s*domiciliad[oa]\s+)?n[ao]\s*(.+?)(?:CEP|,\s*com\s*correio)/i);
  if (end) caso.recl_endereco = end.replace(/[,\s]+$/, '').trim();

  // Função — linha "FUNÇÃO:" ou a palavra entre estado civil e "portador"
  const func = matchAny(t, [
    /FUN[ÇC][ÃA]O[:\s]*\n?\s*([A-ZÀ-Ýa-zà-ÿ\s]+?)(?:\n|$)/i,
    /,\s*([A-ZÀ-Ý]{4,}),\s*portador/i,
  ]);
  if (func) caso.funcao = func.trim();

  // CNPJs — reclamadas (formato XX.XXX.XXX/XXXX-XX)
  const cnpjs = [...t.matchAll(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g)].map((m) => limparDigitos(m[1])).filter((d) => d.length === 14);
  if (cnpjs[0]) caso.recl1_cnpj = cnpjs[0];
  if (cnpjs[1]) caso.recl2_cnpj = cnpjs[1];

  // Nomes das reclamadas — após "1ª RECLAMADA:" / "2ª RECLAMADA:" até "CNPJ"
  const r1 = matchAny(t, /1[ªa]\s*RECLAMADA[:\s]*\n?\s*(.+?)(?:CNPJ|$)/i);
  if (r1) caso.recl1_nome = r1.trim();
  const r2 = matchAny(t, /2[ªa]\s*RECLAMADA[:\s]*\n?\s*(.+?)(?:CNPJ|$)/i);
  if (r2) caso.recl2_nome = r2.trim();

  // Endereços das reclamadas (após "ENDEREÇO:") — 1ª e 2ª ocorrência.
  // Essencial p/ a competência: sem o endereço da tomadora (recl2), o template
  // vazava a residência do reclamante como local de prestação.
  const endsLog = [...t.matchAll(/ENDERE[ÇC]O[:\s]*([^\n]+)/gi)].map((m) => m[1].trim());
  if (endsLog[0]) caso.recl1_logradouro = endsLog[0];
  if (endsLog[1]) caso.recl2_logradouro = endsLog[1];

  // E-mail pessoal do reclamante. Robusto a roteiros diferentes de entrevista:
  // tenta rótulos comuns (correio eletrônico / e-mail / email) e, se não houver,
  // varre o texto inteiro por e-mails, excluindo o domínio do escritório —
  // fica com o primeiro e-mail pessoal (não corporativo). Sem isto, a minuta
  // dizia "O autor não possui correio eletrônico" mesmo com o e-mail na entrevista.
  const OFFICE_DOM = /favadvogados|@advogados\b|juridico@/i;
  function extrairEmailPessoal(texto) {
    const labelMatch = /\b(?:correio\s*eletr[ôo]nico|e-?mail|correio)\s*[:=]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.exec(texto);
    if (labelMatch && !OFFICE_DOM.test(labelMatch[1])) return labelMatch[1].trim().toLowerCase();
    const todos = [...texto.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => m[0]);
    const pessoais = todos.filter((e) => !OFFICE_DOM.test(e));
    const alvo = pessoais[0];
    return alvo ? alvo.trim().toLowerCase() : undefined;
  }
  const emailPessoal = extrairEmailPessoal(t);
  if (emailPessoal) caso.recl_email = emailPessoal;

  // Datas de admissão e rescisão
  const adm = matchAny(t, /Admiss[ãa]o[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
  if (adm) caso.data_admissao = paraIsoData(adm);
  const res = matchAny(t, [/(?:Sem\s*JUSTA\s*CAUSA|Rescis[ãa]o|Dispensa)[:\s]*(\d{2}\/\d{2}\/\d{4})/i]);
  if (res) caso.data_rescisao = paraIsoData(res);

  // Salário
  const sal = matchAny(t, /Sal[áa]rio[:\s]*([\d.,]+)/i);
  if (sal) {
    const n = comoNumero(sal);
    if (n != null) caso.salario = n;
  }

  // Jornada / escala — captura a linha completa da jornada; escala separada
  const jornada = matchAny(t, /Jornada[:\s]*([^\n]+)/i);
  if (jornada) caso.jornada_horario = jornada.trim();
  const escalaMatch = matchAny(t, /(\d+\s*x\s*\d+)/i);
  if (escalaMatch) caso.escala = escalaMatch.replace(/\s+/g, '').toLowerCase();

  // Intervalo intrajornada
  const intervalo = matchAny(t, /Intrajornada[:\s]*([0-9\s/àa-z]+?)(?:\n|$)/i);
  if (intervalo) caso.intervalo_usufruido = intervalo.trim();

  // Folgas trabalhadas — quantidade (média da faixa) e valor
  const folgaFaixa = /FOLGAS\s*LABORADAS[:\s]*(\d+)\s*a\s*(\d+)/i.exec(t);
  if (folgaFaixa) {
    caso.ft_qtd_media = (Number(folgaFaixa[1]) + Number(folgaFaixa[2])) / 2;
    caso.tem_ft = true;
  }
  // Valor das folgas — última ocorrência "FOLGAS LABORADAS:" com valor numérico
  const folgasValores = [...t.matchAll(/FOLGAS\s*LABORADAS[:\s]*([\d.,]+)/gi)].map((m) => m[1]);
  if (folgasValores.length) {
    const v = comoNumero(folgasValores[folgasValores.length - 1]);
    if (v != null) {
      caso.val_ft = v;
      caso.tem_ft = true;
      if (/pix|dinheiro/i.test(t)) {
        caso.tem_integracao_por_fora = true;
        caso.valor_por_fora = v;
      }
    }
  }

  // Desvio de função
  if (/desvio\s*de\s*fun[çc][ãa]o/i.test(t)) {
    caso.tem_desvio = true;
    const desvio = matchAny(t, /desvio\s*DE\s*FUN[ÇC][ÃA]O[:\s]*\n?(.+?)(?:\n\n|DANO\s|MORAL|$)/i);
    if (desvio) caso.desvio_atividades = desvio.trim();
  }
  // Acúmulo de função — só ativa quando a entrevista menciona "acúmulo" explicitamente
  // e como fato DISTINTO do desvio de função. "Prevenção de perdas" já é capturada acima
  // como desvio_atividades; incluí-la também aqui disparava tem_acumulo=true para o MESMO
  // fato, mas sem preencher acumulo_atividades (bloqueado pelo `if (!caso.desvio_atividades)`
  // logo abaixo), gerando uma tese "DO ACÚMULO DE FUNÇÃO" na minuta com o campo de atividades
  // em branco ("atividades de ,") e um pedido de multa de 20% duplicado sobre o mesmo fato
  // já coberto pela multa de 50% do desvio de função.
  if (/ac[úu]mulo\s*de\s*fun[çc][ãa]o/i.test(t) && !caso.desvio_atividades) {
    caso.tem_acumulo = true;
    const ac = matchAny(t, /ac[úu]mulo\s*(?:DE\s*FUN[ÇC][ÃA]O)?[:\s]*\n?(.+?)(?:\n\n|DANO\s|MORAL|$)/i);
    if (ac) caso.acumulo_atividades = ac.trim();
  }

  // Tipo de dispensa
  if (/sem\s*justa\s*causa/i.test(t)) caso.tipo_dispensa = 'sem_justa_causa';
  else if (/rescis[ãa]o\s*indireta/i.test(t)) caso.tipo_dispensa = 'rescisao_indireta';
  else if (/pedido\s*de\s*demiss[ãa]o/i.test(t)) caso.tipo_dispensa = 'nulidade_pedido_demissao';

  // Dano moral
  if (/dano\s*moral/i.test(t)) {
    caso.tem_dano_moral = true;
    const dano = matchAny(t, /DANO\s*MORAL[:\s]*\n?(.+?)(?:\n\n|$)/i);
    if (dano) caso.dano_fatos = dano.trim();
  }

  // Vigilante -> periculosidade
  if (/vigilante|vigil[âa]ncia/i.test(caso.funcao || t)) caso.tem_periculosidade = true;

  // Noturno (jornada noturna: início >= 18h ou fim <= 7h)
  const horario = caso.jornada_horario || '';
  if (/(?:1[89]|2[0-3])\s*[:h]/i.test(horario) || /0[0-7]\s*[:h]/i.test(horario)) {
    caso.tem_adic_noturno = true;
  }

  return caso;
}