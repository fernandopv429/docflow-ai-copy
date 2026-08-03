import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Paperclip, Send, X, FileText, Bot, FileDown, Library, RefreshCw, CheckCircle2, ScrollText, AlertTriangle,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import ToolTraceMessage from '@/components/ToolTraceMessage';
import SessionLogsModal from '@/components/SessionLogsModal';
import DocumentReviewPreview from '@/components/DocumentReviewPreview';
import { exportarHtmlDocx } from '@/lib/trabalhista/exportarHtmlDocx';
import { TIPO_DISPENSA_LABELS } from '@/lib/trabalhista/tokens';
import { formatBRL } from '@/lib/trabalhista/mathUtils';
import { fontesAuditoria, fontesEntrevista, fontesGeracao } from '@/lib/trabalhista/fontesAnalise';
import useConsoleLogs from '@/hooks/useConsoleLogs';
import {
  conversarEntrevista,
  gerarPecaPadrao,
  carregarModeloPadrao,
  verificarCoerencia,
} from '@/lib/trabalhista/modelosReferencia';
import ConfirmacaoGeracao from '@/components/ConfirmacaoGeracao';

export default function GerarPorEntrevista() {
  const [messages, setMessages] = useState([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const consoleLogs = useConsoleLogs();
  const [input, setInput] = useState(() => localStorage.getItem('docflow:entrevista-texto') || '');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved');
  const draftCaseIdRef = useRef(localStorage.getItem('docflow:caso-rascunho-id'));
  const saveTimerRef = useRef(null);

  const [allUrls, setAllUrls] = useState([]);
  const [documentSources, setDocumentSources] = useState([]);
  const [attrs, setAttrs] = useState(null);
  const [config, setConfig] = useState(null);
  const [modeloPadrao, setModeloPadrao] = useState(null);
  const [ultimaGeracao, setUltimaGeracao] = useState(null);

  // Documento vivo (painel à direita) — preview do template .docx preenchido
  const [docHtml, setDocHtml] = useState('');
  const endRef = useRef(null);

  const temTemplate = !!modeloPadrao?.html;

  useEffect(() => {
    base44.entities.IntegracaoConfig.list('-updated_date', 1).then((l) => setConfig(l?.[0] || null)).catch(() => {});
    carregarModeloPadrao().then(setModeloPadrao).catch(() => setModeloPadrao(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, generating]);

  const userText = messages.filter((m) => m.role === 'user').map((m) => m.text).filter(Boolean).join('\n\n');

  useEffect(() => {
    const textoCompleto = [userText, input.trim()].filter(Boolean).join('\n\n');
    if (!textoCompleto) return;

    localStorage.setItem('docflow:entrevista-texto', textoCompleto);
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
          localStorage.setItem('docflow:caso-rascunho-id', caso.id);
        }
        setSaveStatus('saved');
      } catch (error) {
        console.error(error);
        setSaveStatus('local');
      }
    }, 700);

    return () => clearTimeout(saveTimerRef.current);
  }, [input, userText]);

  const gerarMinuta = async (opts = {}) => {
    if (generating) return;
    setGenerating(true);
    try {
      const geracaoTexto = opts.texto ?? userText;
      const { html, valorCausa, pedidos, dadosReceita, dadosCep, dadosDatajud, dadosCct, calculos, caso, modeloSemelhante } = await gerarPecaPadrao({
        texto: geracaoTexto,
        fileUrls: opts.urls ?? allUrls,
        attrs: opts.attrs ?? attrs,
        modeloPadrao,
        onTool: (msg) => setMessages((m) => [...m, { role: 'tool', text: msg }]),
      });

      const documentoTexto = (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      setDocHtml(html);
      setUltimaGeracao({ html, valorCausa, caso, calculos, dadosReceita });
      setReviewConfirmed(false);

      const retornos = [
        dadosReceita?.length && { role: 'tool_result', title: 'Retorno da Receita Federal (BrasilAPI)', text: JSON.stringify(dadosReceita, null, 2) },
        dadosCep?.length && { role: 'tool_result', title: 'Retorno da consulta de CEP', text: JSON.stringify(dadosCep, null, 2) },
        dadosDatajud?.length && { role: 'tool_result', title: 'Retorno do DataJud/CNJ', text: JSON.stringify(dadosDatajud, null, 2) },
        caso && Object.keys(caso).length && { role: 'tool_result', title: 'Dados analisados e extraídos pela IA', text: JSON.stringify(caso, null, 2) },
        calculos?.length && { role: 'tool_result', title: 'Retorno dos cálculos determinísticos', text: JSON.stringify(calculos, null, 2) },
        dadosCct?.clausulas?.length && { role: 'tool_result', title: `Cláusulas da CCT aplicável${dadosCct.meta?.titulo ? ` — ${dadosCct.meta.titulo}` : ''}`, text: JSON.stringify(dadosCct.clausulas.map((c) => ({ clausula: `${c.clausula_ref} — ${c.clausula_titulo}`, cct: c.titulo, conteudo: c.conteudo, fonte: c.fonte_url })), null, 2) },
        { role: 'tool_result', title: 'Valor da causa e rol de pedidos', text: JSON.stringify({ valorCausa, pedidos }, null, 2) },
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
      let nota = modeloPadrao
        ? 'Petição redigida pela IA. Confira o documento ao lado e confirme a revisão antes de exportar.'
        : 'Defina o modelo padrão em Configurações para gerar a petição.';
      if (verificados.length) {
        nota += ` CNPJ(s) confirmado(s) na Receita: ${verificados.map((d) => `${d.razao_social} (${d.cnpj})`).join('; ')}.`;
      }
      if (valorCausa != null) nota += `\n\nValor da causa: ${formatBRL(valorCausa)}.`;
      const comValor = (calculos || []).filter((c) => c.valor != null);
      if (comValor.length) {
        nota += `\n\nCálculos determinísticos (por código, sem IA):\n${comValor.map((c) => `• ${c.item}: ${formatBRL(c.valor)}`).join('\n')}`;
      }
      setMessages((m) => [...m, { role: 'assistant', text: nota }]);

      // Verificação de coerência jurídica (LLM audita, não reescreve)
      setMessages((m) => [...m, { role: 'tool', text: 'Verificando coerência jurídica da peça...' }]);
      try {
        const verif = await verificarCoerencia({ texto: geracaoTexto, caso, dados: caso, documentoTexto });
        const alertas = verif?.alertas || [];
        const icone = { BLOQUEANTE: '⛔', ATENCAO: '⚠️', INFO: 'ℹ️' };
        const cabecalho = `Verificação de coerência — status: ${verif?.status || 'concluída'}.`;
        const corpo = alertas.length
          ? '\n' + alertas.map((a) => `${icone[a.severidade] || '•'} ${a.descricao}${a.sugestao ? ` — ${a.sugestao}` : ''}`).join('\n')
          : ' Nenhum problema aparente. A revisão humana do advogado continua obrigatória.';
        setMessages((m) => [
          ...m,
          { role: 'tool_result', title: 'Retorno da auditoria de coerência (IA)', text: JSON.stringify(verif, null, 2) },
          {
            role: 'tool_result',
            title: 'Fontes consultadas nesta auditoria',
            text: JSON.stringify(fontesAuditoria({
              texto: geracaoTexto,
              referencia: modeloSemelhante,
            }), null, 2),
          },
          { role: 'assistant', text: cabecalho + corpo },
        ]);
      } catch (e) {
        console.error(e);
      }
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

      const transcript = novasMsgs
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, text: m.text || '' }));
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
      await exportarHtmlDocx(ultimaGeracao.html, 'Petição inicial');
    } catch (err) {
      console.error(err);
      window.alert(`Não foi possível exportar o documento: ${err?.message || 'verifique a petição gerada.'}`);
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
            Converse à esquerda; a IA redige a petição ao lado e exporta em .docx editável.
          </p>
        </div>
        <button
          onClick={() => setLogsOpen(true)}
          className="p-2 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded-full"
          title="Ver logs da sessão"
        >
          <ScrollText className="w-4 h-4" />
        </button>
        <Link to="/modelos" className="flex items-center gap-1.5 text-xs text-[#1a73e8] hover:underline whitespace-nowrap">
          <Library className="w-3.5 h-3.5" /> Configurações
        </Link>
      </div>

      {/* Barra do template .docx */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-[#f1f3f4] bg-white flex-shrink-0">
        <span className="text-xs text-[#5f6368]">Modelo padrão:</span>
        {temTemplate ? (
          <span className="text-xs font-medium text-[#0b8043] truncate max-w-[420px]">
            {modeloPadrao?.titulo || 'configurado'}
          </span>
        ) : (
          <Link to="/modelos" className="text-xs font-medium text-[#c5221f] hover:underline">
            nenhum — definir em Configurações
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
                title="Regenerar a petição com a IA"
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
              title={!temTemplate ? 'Defina o modelo padrão em Configurações' : !reviewConfirmed ? 'Confirme a revisão antes de exportar' : 'Exportar DOCX da petição'}
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
                <p className="text-sm text-[#5f6368]">Nenhum modelo padrão configurado.</p>
                <p className="text-xs text-[#9aa0a6] mt-1">
                  Defina o modelo padrão do escritório em{' '}
                  <Link to="/modelos" className="text-[#1a73e8] hover:underline">Configurações</Link>.
                </p>
              </div>
            ) : docHtml ? (
              <DocumentReviewPreview html={docHtml} dimmed={generating} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <FileText className="w-10 h-10 text-[#dadce0] mb-3" />
                <p className="text-sm text-[#5f6368]">A petição preenchida aparecerá aqui.</p>
                <p className="text-xs text-[#9aa0a6] mt-1">Envie a entrevista à esquerda — a petição será redigida pela IA automaticamente.</p>
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
      <SessionLogsModal open={logsOpen} onOpenChange={setLogsOpen} messages={[...messages, ...consoleLogs]} />
    </div>
  );
}