import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Paperclip, Send, X, FileText, Bot, FileDown, Library, RefreshCw, CheckCircle2, ScrollText, AlertTriangle, Inbox,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import ToolTraceMessage from '@/components/ToolTraceMessage';
import SessionLogsModal from '@/components/SessionLogsModal';
import DocumentReviewPreview from '@/components/DocumentReviewPreview';
import { exportarDocxTemplate } from '@/lib/preencherDocxTemplate';
import { TIPO_DISPENSA_LABELS } from '@/lib/trabalhista/tokens';
import { formatBRL } from '@/lib/trabalhista/mathUtils';
import { fontesEntrevista, fontesGeracao } from '@/lib/trabalhista/fontesAnalise';
import useConsoleLogs from '@/hooks/useConsoleLogs';
import {
  conversarEntrevista,
  gerarDadosPeca,
} from '@/lib/trabalhista/modelosReferencia';
import {
  carregarEsqueletoTemplate,
  preencherEsqueleto,
  textoDaPeca,
} from '@/lib/trabalhista/previewTemplate';
import ConfirmacaoGeracao from '@/components/ConfirmacaoGeracao';
import FilaWebhooks from '@/components/FilaWebhooks';
import { montarDadosTemplate } from '@/lib/trabalhista/dadosTemplate';

// ============================================================
// Instância isolada do agente de entrevista.
// Cada sessionId tem histórico, estado, variáveis, arquivos,
// atributos e rascunho próprios — sem compartilhar contexto com
// as demais sessões. Toda a lógica do agente é idêntica à original.
// ============================================================
// Serializa o caso estruturado de um webhook num texto rótulo:valor que a IA
// de entrevista e o regex de "faltando" reconhecem (Nome, CPF, Função,
// Admissão, Rescisão, Salário, CNPJ, Jornada...). O caso do webhook vive em
// analise_json.caso — o entrevista_texto costuma vir vazio, sem isto o chat
// não enxerga os dados ao processar uma correção.
const TIPO_DISPENSA_CURTO = {
  sem_justa_causa: 'Sem justa causa',
  rescisao_indireta: 'Rescisão indireta',
  nulidade_pedido_demissao: 'Pedido de demissão',
  reversao_justa_causa: 'Reversão de justa causa',
  acordo: 'Acordo',
};
function dataIsoParaBr(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
function serializarCasoWebhook(caso = {}) {
  const linhas = [];
  if (caso.recl_nome) linhas.push(`Nome: ${caso.recl_nome}`);
  if (caso.recl_cpf) linhas.push(`CPF: ${caso.recl_cpf}`);
  if (caso.recl_rg) linhas.push(`RG: ${caso.recl_rg}`);
  if (caso.recl_pis) linhas.push(`PIS: ${caso.recl_pis}`);
  if (caso.recl_ctps) linhas.push(`CTPS: ${caso.recl_ctps}`);
  if (caso.recl_endereco) linhas.push(`Endereço: ${caso.recl_endereco}`);
  if (caso.funcao) linhas.push(`Função: ${caso.funcao}`);
  if (caso.data_admissao) linhas.push(`Admissão: ${dataIsoParaBr(caso.data_admissao)}`);
  if (caso.data_rescisao) linhas.push(`Rescisão: ${dataIsoParaBr(caso.data_rescisao)}`);
  if (caso.salario != null) linhas.push(`Salário: ${caso.salario}`);
  if (caso.tipo_dispensa) linhas.push(`Modalidade: ${TIPO_DISPENSA_CURTO[caso.tipo_dispensa] || caso.tipo_dispensa}`);
  if (caso.jornada_horario) linhas.push(`Jornada: ${caso.jornada_horario}`);
  if (caso.escala) linhas.push(`Escala: ${caso.escala}`);
  if (caso.recl1_nome) linhas.push(`1ª Reclamada: ${caso.recl1_nome}`);
  if (caso.recl1_cnpj) linhas.push(`CNPJ: ${caso.recl1_cnpj}`);
  if (caso.recl1_logradouro) linhas.push(`Endereço da reclamada: ${caso.recl1_logradouro}`);
  if (caso.recl2_nome) linhas.push(`2ª Reclamada: ${caso.recl2_nome}`);
  if (caso.recl2_cnpj) linhas.push(`CNPJ tomadora: ${caso.recl2_cnpj}`);
  if (caso.local_prestacao) linhas.push(`Local de prestação: ${caso.local_prestacao}`);
  if (caso.dano_fatos) linhas.push(`Dano moral: ${caso.dano_fatos}`);
  return linhas.join('\n');
}

export default function EntrevistaSession({ sessionId, active = true }) {
  const SK_TEXT = `docflow:entrevista-texto:${sessionId}`;
  const SK_CASE = `docflow:caso-rascunho-id:${sessionId}`;

  const [messages, setMessages] = useState([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const consoleLogs = useConsoleLogs();
  const [input, setInput] = useState(() => localStorage.getItem(SK_TEXT) || '');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved');
  const draftCaseIdRef = useRef(localStorage.getItem(SK_CASE));
  const saveTimerRef = useRef(null);

  const [allUrls, setAllUrls] = useState([]);
  const [documentSources, setDocumentSources] = useState([]);
  const [attrs, setAttrs] = useState(null);
  const [config, setConfig] = useState(null);
  const [ultimaGeracao, setUltimaGeracao] = useState(null);
  // Caso aberto a partir da fila de webhooks. Quando presente, a geração
  // (Atualizar) e o reconhecimento do chat usam estes dados em vez de
  // reextrair do resumo curto exibido nas mensagens.
  const [casoWebhook, setCasoWebhook] = useState(null);
  const [filaOpen, setFilaOpen] = useState(false);
  const [filaCount, setFilaCount] = useState(0);

  // Documento vivo (painel à direita) — preview do template .docx preenchido
  const [docHtml, setDocHtml] = useState('');
  const endRef = useRef(null);

  const temTemplate = !!config?.template_docx_url;

  useEffect(() => {
    base44.entities.IntegracaoConfig.list('-updated_date', 1).then((l) => setConfig(l?.[0] || null)).catch(() => {});
  }, []);

  const atualizarFilaCount = () => {
    base44.entities.CasoTrabalhista.list('-created_date', 50)
      .then((l) => setFilaCount((l || []).filter((c) => c.analise_json?.origem === 'webhook').length))
      .catch(() => {});
  };
  useEffect(() => { atualizarFilaCount(); const t = setInterval(atualizarFilaCount, 15000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (active) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, generating, active]);

  const userText = messages.filter((m) => m.role === 'user').map((m) => m.text).filter(Boolean).join('\n\n');

  useEffect(() => {
    const textoCompleto = [userText, input.trim()].filter(Boolean).join('\n\n');
    if (!textoCompleto) return;

    localStorage.setItem(SK_TEXT, textoCompleto);
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const payload = {
        titulo: textoCompleto.slice(0, 80),
        status: 'rascunho',
        entrevista_texto: textoCompleto,
      };
      try {
        if (draftCaseIdRef.current) {
          await base44.entities.CasoTrabalhista.update(draftCaseIdRef.current, payload);
        } else {
          const caso = await base44.entities.CasoTrabalhista.create(payload);
          draftCaseIdRef.current = caso.id;
          localStorage.setItem(SK_CASE, caso.id);
        }
        setSaveStatus('saved');
      } catch (error) {
        console.error(error);
        setSaveStatus('local');
      }
    }, 700);

    return () => clearTimeout(saveTimerRef.current);
  }, [input, userText, SK_TEXT, SK_CASE]);

  const gerarMinuta = async (opts = {}) => {
    if (generating) return;
    setGenerating(true);
    try {
      // Caso de webhook aberto na fila: usa o caso estruturado já mapeado
      // (casoPreMapeado) em vez de reextrair do resumo curto do chat, e o
      // texto integral da entrevista como contexto.
      const usarCasoWebhook = !opts.casoPreMapeado && casoWebhook;
      const geracaoTexto = opts.texto ?? (userText || (usarCasoWebhook ? casoWebhook.entrevista_texto : ''));
      const { dados, dadosReceita, dadosCep, dadosDatajud, dadosCct, calculos, caso, modeloSemelhante } = await gerarDadosPeca({
        texto: geracaoTexto,
        fileUrls: opts.urls ?? allUrls,
        attrs: opts.attrs ?? attrs,
        casoPreMapeado: opts.casoPreMapeado ?? (usarCasoWebhook ? casoWebhook.caso : null),
        redigirIA: true,
        onTool: (msg) => setMessages((m) => [...m, { role: 'tool', text: msg }]),
      });

      // Preview a partir do próprio template .docx (fonte única)
      let html = '';
      let documentoTexto = '';
      if (config?.template_docx_url) {
        try {
          const esqueleto = await carregarEsqueletoTemplate(config.template_docx_url);
          html = preencherEsqueleto(esqueleto, dados, { highlight: true });
          documentoTexto = textoDaPeca(esqueleto, dados);
        } catch (e) {
          console.error(e);
          setMessages((m) => [...m, { role: 'assistant', text: `Não consegui carregar o template .docx para o preview: ${e.message || 'verifique o arquivo em Configurações.'}` }]);
        }
      }
      setDocHtml(html);
      setUltimaGeracao({ caso, calculos, dados, dadosReceita });
      setReviewConfirmed(false);

      const retornos = [
        dadosReceita?.length && { role: 'tool_result', title: 'Retorno da Receita Federal (BrasilAPI)', text: JSON.stringify(dadosReceita, null, 2) },
        dadosCep?.length && { role: 'tool_result', title: 'Retorno da consulta de CEP', text: JSON.stringify(dadosCep, null, 2) },
        dadosDatajud?.length && { role: 'tool_result', title: 'Retorno do DataJud/CNJ', text: JSON.stringify(dadosDatajud, null, 2) },
        caso && Object.keys(caso).length && { role: 'tool_result', title: 'Dados analisados e extraídos pela IA', text: JSON.stringify(caso, null, 2) },
        calculos?.length && { role: 'tool_result', title: 'Retorno dos cálculos determinísticos', text: JSON.stringify(calculos, null, 2) },
        dadosCct?.clausulas?.length && { role: 'tool_result', title: `Cláusulas da CCT aplicável${dadosCct.meta?.titulo ? ` — ${dadosCct.meta.titulo}` : ''}`, text: JSON.stringify(dadosCct.clausulas.map((c) => ({ clausula: `${c.clausula_ref} — ${c.clausula_titulo}`, cct: c.titulo, conteudo: c.conteudo, fonte: c.fonte_url })), null, 2) },
        { role: 'tool_result', title: 'Dados e flags aplicados ao template', text: JSON.stringify(dados, null, 2) },
        modeloSemelhante && { role: 'tool_result', title: 'Modelo de referência selecionado', text: JSON.stringify(modeloSemelhante, null, 2) },
        {
          role: 'tool_result',
          title: 'Fontes consultadas nesta geração',
          text: JSON.stringify(fontesGeracao({
            texto: geracaoTexto,
            documentos: opts.sources ?? documentSources,
            referencia: modeloSemelhante,
            dadosReceita,
            dadosCep,
            dadosDatajud,
            dadosCct,
          }), null, 2),
        },
      ].filter(Boolean);
      if (retornos.length) setMessages((m) => [...m, ...retornos]);

      const verificados = (dadosReceita || []).filter((d) => !d.erro);
      let nota = temTemplate
        ? 'Dados aplicados ao template. Confira os campos destacados no documento ao lado.'
        : 'Dados extraídos. Envie o template .docx em Configurações para gerar e exportar a petição.';
      if (verificados.length) {
        nota += ` CNPJ(s) confirmado(s) na Receita: ${verificados.map((d) => `${d.razao_social} (${d.cnpj})`).join('; ')}.`;
      }
      const comValor = (calculos || []).filter((c) => c.valor != null);
      if (comValor.length) {
        nota += `\n\nCálculos determinísticos (por código, sem IA):\n${comValor.map((c) => `• ${c.item}: ${formatBRL(c.valor)}`).join('\n')}`;
      }
      setMessages((m) => [...m, { role: 'assistant', text: nota }]);

    } catch (err) {
      console.error(err);
      setMessages((m) => [...m, { role: 'assistant', text: 'Erro ao gerar a peça. Tente novamente.' }]);
    }
    setGenerating(false);
  };

  const handleSend = async (opts = {}) => {
    const text = opts.texto !== undefined ? opts.texto : input.trim();
    const attached = opts.arquivos !== undefined ? opts.arquivos : files;
    if (sending || generating || (!text && attached.length === 0)) return;
    const novasMsgs = [...messages, { role: 'user', text, files: attached.map((f) => f.name) }];
    setMessages(novasMsgs);
    setInput('');
    setFiles([]);
    setSending(true);
    try {
      let urls = allUrls;
      let fontesAtuais = documentSources;
      if (attached.length) {
        const novos = [];
        const novasFontes = [];
        for (const file of attached) {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          novos.push(file_url);
          novasFontes.push({ nome: file.name, url: file_url });
        }
        urls = [...allUrls, ...novos];
        fontesAtuais = [...documentSources, ...novasFontes];
        setAllUrls(urls);
        setDocumentSources(fontesAtuais);
      }

      // Caso de webhook: reinjeta o texto integral da entrevista como contexto
      // no transcript, para a IA enxergar os dados do caso (e não só o resumo
      // curto exibido no chat) ao processar uma correção.
      const transcriptBase = novasMsgs
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, text: m.text || '' }));
      // Caso de webhook: injeta os dados estruturados do caso (serializados)
      // como contexto no transcript — a IA e o regex de "faltando" passam a
      // enxergar os dados do caso ao processar uma correção.
      const contextoWebhook = casoWebhook
        ? [casoWebhook.entrevista_texto, serializarCasoWebhook(casoWebhook.caso)].filter(Boolean).join('\n\n')
        : '';
      const transcript = contextoWebhook
        ? [{ role: 'user', text: contextoWebhook }, ...transcriptBase]
        : transcriptBase;
      const res = await conversarEntrevista({
        transcript,
        fileUrls: urls,
        modelos: [],
        attrsAtuais: attrs || {},
      });

      const novoAttrs = { ...(attrs || {}), ...(res?.atributos || {}) };
      setAttrs(novoAttrs);
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: res?.reply || 'Certo.' },
        {
          role: 'tool_result',
          title: 'Análise da IA sobre a entrevista',
          text: JSON.stringify({
            atributos: res?.atributos || {},
            pronto_para_gerar: res?.pronto_para_gerar ?? false,
          }, null, 2),
        },
        {
          role: 'tool_result',
          title: 'Fontes consultadas nesta análise',
          text: JSON.stringify(fontesEntrevista({
            texto: transcript.filter((message) => message.role === 'user').map((message) => message.text).join('\n\n'),
            documentos: fontesAtuais,
          }), null, 2),
        },
      ]);

      // Inicia a geração/atualização automaticamente após cada envio
      const textoCompleto = novasMsgs
        .filter((m) => m.role === 'user')
        .map((m) => m.text)
        .filter(Boolean)
        .join('\n\n');
      if (res?.pronto_para_gerar) {
        await gerarMinuta({ texto: textoCompleto, urls, attrs: novoAttrs, sources: fontesAtuais });
      } else {
        setMessages((m) => [
          ...m.filter((msg) => msg.role !== 'confirm_geracao' || msg.status !== null),
          {
            role: 'confirm_geracao',
            pending: { texto: textoCompleto, urls, attrs: novoAttrs, sources: fontesAtuais },
            faltando: res?.faltando || [],
            status: null,
          },
        ]);
      }
    } catch (err) {
      console.error(err);
      setMessages((m) => [...m, { role: 'assistant', text: 'Erro ao processar. Tente novamente.' }]);
    }
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const abrirCasoPronto = async (casoDb) => {
    const aj = casoDb?.analise_json || {};
    const caso = aj.caso || {};
    const calculos = aj.calculos || [];
    const dadosReceita = aj.dadosReceita || [];
    const dadosCep = aj.dadosCep || [];
    const blocos = aj.blocos || {};
    setFilaOpen(false);
    setMessages([
      { role: 'user', text: `📋 Caso recebido via webhook — ${casoDb.recl_nome || caso.recl_nome || 'Caso'}` },
      { role: 'assistant', text: 'Petição gerada automaticamente pelo webhook. Confira o documento ao lado e exporte quando revisar.' },
    ]);
    // Reconstroi o `dados` (determinístico) + merge dos capítulos redigidos pela IA
    let dados = {};
    try {
      dados = montarDadosTemplate({ caso, calculos, attrs: caso, dadosReceita, dadosCep });
    } catch (e) { console.error(e); }
    Object.assign(dados, blocos);
    if (blocos.BLOCO_DANO_MORAL) dados.DANO_MORAL_FATO_ESPECIFICO = blocos.BLOCO_DANO_MORAL;
    // Preview do template preenchido
    let html = '';
    if (config?.template_docx_url) {
      try {
        const esqueleto = await carregarEsqueletoTemplate(config.template_docx_url);
        html = preencherEsqueleto(esqueleto, dados, { highlight: true });
      } catch (e) { console.error(e); }
    }
    setDocHtml(html);
    setUltimaGeracao({ caso, calculos, dados });
    setReviewConfirmed(false);
    setAttrs(caso);
    setCasoWebhook({ caso, entrevista_texto: casoDb.entrevista_texto || '' });
  };

  const confirmarGeracao = async (pending, msgIndex) => {
    setMessages((m) => m.map((msg, i) => (i === msgIndex ? { ...msg, status: 'aprovado' } : msg)));
    await gerarMinuta(pending);
  };

  const rejeitarGeracao = (msgIndex) => {
    setMessages((m) => m.map((msg, i) => (i === msgIndex ? { ...msg, status: 'rejeitado' } : msg)));
  };

  const exportar = async () => {
    if (!temTemplate || !ultimaGeracao || !reviewConfirmed || exporting) return;
    setExporting(true);
    try {
      await exportarDocxTemplate(config.template_docx_url, ultimaGeracao.dados, 'Petição inicial');
    } catch (err) {
      console.error(err);
      window.alert(`Não foi possível exportar o documento: ${err?.message || 'verifique o template .docx e as tags.'}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#f8f9fa]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[#dadce0] bg-white flex-shrink-0">
        <Link to="/modelos" className="text-[#5f6368] hover:text-[#202124]" title="Modelos / Configurações">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-[#202124]">Gerar por Entrevista</h1>
          <p className="text-xs text-[#5f6368] truncate">
            Converse à esquerda; a petição preenche o template ao lado e é exportada fiel ao .docx.
          </p>
        </div>
        <button
          onClick={() => setLogsOpen(true)}
          className="p-2 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded-full"
          title="Ver logs da sessão"
        >
          <ScrollText className="w-4 h-4" />
        </button>
        <button
          onClick={() => setFilaOpen(true)}
          className="relative p-2 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded-full"
          title="Fila de entrevistas (webhook)"
        >
          <Inbox className="w-4 h-4" />
          {filaCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-[#1a73e8] text-white text-[10px] font-semibold rounded-full flex items-center justify-center">
              {filaCount}
            </span>
          )}
        </button>
        <Link to="/modelos" className="flex items-center gap-1.5 text-xs text-[#1a73e8] hover:underline whitespace-nowrap">
          <Library className="w-3.5 h-3.5" /> Configurações
        </Link>
      </div>

      {/* Barra do template .docx */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-[#f1f3f4] bg-white flex-shrink-0">
        <span className="text-xs text-[#5f6368]">Template .docx:</span>
        {temTemplate ? (
          <span className="text-xs font-medium text-[#0b8043] truncate max-w-[420px]">
            {config.template_docx_nome || 'enviado'}
          </span>
        ) : (
          <Link to="/modelos" className="text-xs font-medium text-[#c5221f] hover:underline">
            nenhum — enviar em Configurações
          </Link>
        )}
        {attrs && (attrs.funcao || attrs.tipo_dispensa) && (
          <span className="text-[11px] text-[#9aa0a6]">
            {attrs.funcao || '—'} · {TIPO_DISPENSA_LABELS[attrs.tipo_dispensa]?.split('(')[0]?.trim() || attrs.tipo_dispensa || '—'}
          </span>
        )}
        {generating && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[#1a73e8]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Preenchendo a peça...
          </span>
        )}
      </div>

      {/* Corpo: chat (esq) + documento (dir) */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Chat */}
        <div className="flex flex-col min-h-0 lg:w-[420px] lg:flex-shrink-0 lg:border-r border-[#dadce0]">
          <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
            <div className="space-y-3">
              {messages.length === 0 && (
                <div className="text-center py-10">
                  <Bot className="w-8 h-8 text-[#dadce0] mx-auto mb-2" />
                  <p className="text-sm text-[#5f6368]">
                    Descreva o caso ou cole a entrevista.
                    <br />Pode anexar documentos e enviar mais informações a qualquer momento.
                  </p>
                </div>
              )}
              {messages.map((m, i) =>
                m.role === 'tool' || m.role === 'tool_result' ? (
                  <ToolTraceMessage key={i} message={m} />
                ) : m.role === 'confirm_geracao' ? (
                  <ConfirmacaoGeracao
                    key={i}
                    status={m.status}
                    faltando={m.faltando}
                    disabled={generating || sending}
                    onConfirmar={() => confirmarGeracao(m.pending, i)}
                    onRejeitar={() => rejeitarGeracao(i)}
                  />
                ) : (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[88%] px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-[#1a73e8] text-white rounded-br-sm'
                          : 'bg-white border border-[#dadce0] text-[#3c4043] rounded-bl-sm'
                      }`}
                    >
                      {m.files?.length > 0 && (
                        <div className="mb-1.5 space-y-0.5">
                          {m.files.map((name, j) => (
                            <div key={j} className="flex items-center gap-1 text-[12px] opacity-90">
                              <FileText className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {m.text}
                    </div>
                  </div>
                )
              )}
              {(sending || generating) && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 px-3.5 py-2 bg-white border border-[#dadce0] rounded-2xl rounded-bl-sm text-sm text-[#5f6368]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#1a73e8]" />
                    {generating ? 'Preenchendo o documento...' : 'Pensando...'}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* Barra de entrada */}
          <div className="flex-shrink-0 border-t border-[#dadce0] bg-white px-3 py-3">
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {files.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 px-2 py-1 bg-[#e8f0fe] text-[#1a73e8] text-[11px] rounded-md">
                    <FileText className="w-3 h-3" />
                    <span className="max-w-[140px] truncate">{f.name}</span>
                    <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5 border border-[#dadce0] rounded-2xl px-2 py-1.5 focus-within:border-[#1a73e8] transition-colors">
              <label className="p-2 text-[#5f6368] hover:bg-[#f1f3f4] rounded-full cursor-pointer" title="Anexar documento">
                <Paperclip className="w-4 h-4" />
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.docx,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const novos = Array.from(e.target.files);
                    e.target.value = '';
                    if (!novos.length) return;
                    setFiles((prev) => [...prev, ...novos]);
                    // Anexar a entrevista em PDF/DOCX dispara a leitura automática
                    // (quando não há texto sendo digitado) — não é preciso "enviar".
                    if (!input.trim()) handleSend({ texto: '', arquivos: novos });
                  }}
                />
              </label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Descreva o caso, peça um ajuste ou envie documentos..."
                rows={1}
                className="flex-1 px-1 py-2 text-sm bg-transparent resize-none focus:outline-none max-h-40"
              />
              <span className="pb-2 text-[10px] text-[#9aa0a6] whitespace-nowrap">
                {saveStatus === 'saving' ? 'Salvando...' : saveStatus === 'local' ? 'Salvo neste dispositivo' : 'Salvo'}
              </span>
              <button
                onClick={handleSend}
                disabled={sending || generating || (!input.trim() && files.length === 0)}
                className="p-2 bg-[#1a73e8] text-white rounded-full hover:bg-[#1557b0] transition-colors disabled:opacity-40"
                title="Enviar"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Documento */}
        <div className="flex flex-col min-h-0 flex-1 bg-[#f1f3f4]">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#dadce0] bg-white flex-shrink-0">
            <FileText className="w-4 h-4 text-[#1a73e8]" />
            <span className="text-sm font-medium text-[#202124] truncate flex-1">Petição</span>
            {docHtml && (
              <button
                onClick={() => gerarMinuta()}
                disabled={generating}
                title="Reaplicar os dados ao template"
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#dadce0] text-[#3c4043] rounded-lg text-xs font-medium hover:bg-[#f1f3f4] transition-colors disabled:opacity-40"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Atualizar
              </button>
            )}
            {docHtml && !reviewConfirmed && (
              <span className="hidden md:inline text-[11px] text-[#8a5d00]">
                Confira os campos destacados
              </span>
            )}
            {docHtml && !reviewConfirmed && (
              <button
                onClick={() => setReviewConfirmed(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1a73e8] text-[#1a73e8] rounded-lg text-xs font-medium hover:bg-[#e8f0fe] transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar revisão
              </button>
            )}
            <button
              onClick={exportar}
              disabled={!temTemplate || !ultimaGeracao || !reviewConfirmed || exporting}
              title={!temTemplate ? 'Envie o template .docx em Configurações' : !reviewConfirmed ? 'Confirme a revisão antes de exportar' : 'Exportar DOCX fiel ao modelo'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0b8043] text-white rounded-lg text-xs font-medium hover:bg-[#0a7038] transition-colors disabled:opacity-40"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              {exporting ? 'Exportando...' : 'Exportar DOCX'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 lg:p-8 min-h-0 relative">
            {!temTemplate ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <AlertTriangle className="w-10 h-10 text-[#e0a800] mb-3" />
                <p className="text-sm text-[#5f6368]">Nenhum template .docx configurado.</p>
                <p className="text-xs text-[#9aa0a6] mt-1">
                  Envie o modelo oficial (marcado com as tags) em{' '}
                  <Link to="/modelos" className="text-[#1a73e8] hover:underline">Configurações</Link>.
                </p>
              </div>
            ) : docHtml ? (
              <DocumentReviewPreview html={docHtml} dimmed={generating} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <FileText className="w-10 h-10 text-[#dadce0] mb-3" />
                <p className="text-sm text-[#5f6368]">A petição preenchida aparecerá aqui.</p>
                <p className="text-xs text-[#9aa0a6] mt-1">Envie a entrevista à esquerda — o template será preenchido automaticamente.</p>
              </div>
            )}
            {generating && docHtml && (
              <div className="absolute inset-0 flex items-start justify-center pt-10 pointer-events-none">
                <span className="flex items-center gap-2 px-3 py-1.5 bg-white/90 border border-[#dadce0] rounded-full text-xs text-[#1a73e8] shadow-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Atualizando o documento...
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <FilaWebhooks open={filaOpen} onOpenChange={setFilaOpen} onSelecionar={abrirCasoPronto} />
      <SessionLogsModal open={logsOpen} onOpenChange={setLogsOpen} messages={[...messages, ...consoleLogs]} />
    </div>
  );
}