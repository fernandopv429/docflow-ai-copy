import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Paperclip, Send, X, FileText, Bot, FileDown, Library, RefreshCw, CheckCircle2, ScrollText,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import ToolTraceMessage from '@/components/ToolTraceMessage';
import SessionLogsModal from '@/components/SessionLogsModal';
import DocumentReviewPreview from '@/components/DocumentReviewPreview';
import { exportToDocx } from '@/lib/exportDocx';
import { exportarDocxTemplate } from '@/lib/preencherDocxTemplate';
import { montarDadosTemplate } from '@/lib/trabalhista/dadosTemplate';
import { TIPO_DISPENSA_LABELS } from '@/lib/trabalhista/tokens';
import { formatBRL } from '@/lib/trabalhista/mathUtils';
import { fontesAuditoria, fontesEntrevista, fontesGeracao } from '@/lib/trabalhista/fontesAnalise';
import useConsoleLogs from '@/hooks/useConsoleLogs';
import {
  carregarModeloPadrao,
  conversarEntrevista,
  gerarPecaPadrao,
  verificarCoerencia,
} from '@/lib/trabalhista/modelosReferencia';

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
  const [modeloPadrao, setModeloPadrao] = useState(null);
  const [attrs, setAttrs] = useState(null);
  const [config, setConfig] = useState(null);
  const [ultimaGeracao, setUltimaGeracao] = useState(null);

  // Documento vivo (painel à direita)
  const [docHtml, setDocHtml] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    carregarModeloPadrao().then(setModeloPadrao).catch(() => {});
  }, []);

  useEffect(() => {
    base44.entities.IntegracaoConfig.list('-updated_date', 1).then((l) => setConfig(l?.[0] || null)).catch(() => {});
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
    if (!modeloPadrao || generating) return;
    setGenerating(true);
    setMessages((m) => [...m, { role: 'tool', text: `Usando template principal: ${modeloPadrao.titulo}` }]);
    try {
      const geracaoTexto = opts.texto ?? userText;
      const { html, dadosReceita, dadosCep, dadosDatajud, calculos, caso, modeloSemelhante } = await gerarPecaPadrao({
        texto: geracaoTexto,
        fileUrls: opts.urls ?? allUrls,
        attrs: opts.attrs ?? attrs,
        modeloPadrao,
        force: opts.force,
        onTool: (msg) => setMessages((m) => [...m, { role: 'tool', text: msg }]),
      });
      setDocHtml(html);
      setUltimaGeracao({ caso, calculos, dadosReceita });
      setReviewConfirmed(false);
      const retornos = [
        dadosReceita?.length && { role: 'tool_result', title: 'Retorno da Receita Federal (BrasilAPI)', text: JSON.stringify(dadosReceita, null, 2) },
        dadosCep?.length && { role: 'tool_result', title: 'Retorno da consulta de CEP', text: JSON.stringify(dadosCep, null, 2) },
        dadosDatajud?.length && { role: 'tool_result', title: 'Retorno do DataJud/CNJ', text: JSON.stringify(dadosDatajud, null, 2) },
        caso && Object.keys(caso).length && { role: 'tool_result', title: 'Dados analisados e extraídos pela IA', text: JSON.stringify(caso, null, 2) },
        calculos?.length && { role: 'tool_result', title: 'Retorno dos cálculos determinísticos', text: JSON.stringify(calculos, null, 2) },
        modeloSemelhante && { role: 'tool_result', title: 'Modelo de referência selecionado', text: JSON.stringify(modeloSemelhante, null, 2) },
        {
          role: 'tool_result',
          title: 'Fontes consultadas nesta geração',
          text: JSON.stringify(fontesGeracao({
            texto: geracaoTexto,
            documentos: opts.sources ?? documentSources,
            template: modeloPadrao,
            referencia: modeloSemelhante,
            dadosReceita,
            dadosCep,
            dadosDatajud,
          }), null, 2),
        },
      ].filter(Boolean);
      if (retornos.length) setMessages((m) => [...m, ...retornos]);

      const verificados = (dadosReceita || []).filter((d) => !d.erro);
      let nota = docHtml
        ? 'Documento atualizado com base no modelo padrão. Veja as mudanças ao lado.'
        : 'Minuta gerada com base no modelo padrão. Veja o documento ao lado.';
      if (verificados.length) {
        nota += ` CNPJ(s) confirmado(s) na Receita: ${verificados.map((d) => `${d.razao_social} (${d.cnpj})`).join('; ')}.`;
      }
      const comValor = (calculos || []).filter((c) => c.valor != null);
      if (comValor.length) {
        nota += `\n\nCálculos determinísticos (por código, sem IA):\n${comValor.map((c) => `• ${c.item}: ${formatBRL(c.valor)}`).join('\n')}`;
      }
      setMessages((m) => [...m, { role: 'assistant', text: nota }]);

      // Verificação de coerência jurídica da minuta (LLM audita, não reescreve)
      setMessages((m) => [...m, { role: 'tool', text: 'Verificando coerência jurídica da minuta...' }]);
      try {
        const verif = await verificarCoerencia({ texto: geracaoTexto, caso, html });
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
              template: modeloPadrao,
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
      setMessages((m) => [...m, { role: 'assistant', text: 'Erro ao gerar a minuta. Tente novamente.' }]);
    }
    setGenerating(false);
  };

  const handleSend = async () => {
    if (sending || generating || (!input.trim() && files.length === 0)) return;
    const text = input.trim();
    const attached = files;
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
      const modelosCtx = modeloPadrao ? [{ titulo: modeloPadrao.titulo, teses: [] }] : [];
      const res = await conversarEntrevista({
        transcript,
        fileUrls: urls,
        modelos: modelosCtx,
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

      // Inicia a geração/atualização da minuta automaticamente após cada envio
      const textoCompleto = novasMsgs
        .filter((m) => m.role === 'user')
        .map((m) => m.text)
        .filter(Boolean)
        .join('\n\n');
      if (res?.pronto_para_gerar || docHtml) {
        await gerarMinuta({ texto: textoCompleto, urls, attrs: novoAttrs, sources: fontesAtuais });
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

  const exportarFiel = async () => {
    if (!config?.template_docx_url || !ultimaGeracao || exporting) return;
    setExporting(true);
    try {
      const dados = montarDadosTemplate({ ...ultimaGeracao, attrs });
      await exportarDocxTemplate(config.template_docx_url, dados, 'Petição inicial');
    } catch (err) {
      console.error(err);
      setMessages((m) => [...m, { role: 'assistant', text: `Erro ao exportar fiel ao modelo: ${err.message || 'verifique o template .docx e as tags.'}` }]);
    }
    setExporting(false);
  };

  const exportar = async () => {
    if (!docHtml || !reviewConfirmed || exporting) return;
    setExporting(true);
    try {
      const validacao = await exportToDocx(docHtml, null, 'Minuta - petição inicial');
      setMessages((m) => [...m, {
        role: 'tool_result',
        title: 'Validação da exportação DOCX',
        text: JSON.stringify(validacao, null, 2),
      }]);
    } catch (err) {
      console.error(err);
      window.alert(`Não foi possível exportar o documento: ${err?.message || 'erro desconhecido'}`);
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
            Converse à esquerda; a minuta aparece e se atualiza à direita.
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

      {/* Barra do modelo padrão */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-[#f1f3f4] bg-white flex-shrink-0">
        <span className="text-xs text-[#5f6368]">Template principal:</span>
        <span className="text-xs font-medium text-[#202124] truncate max-w-[420px]">
          {modeloPadrao?.titulo || 'carregando...'}
        </span>
        {attrs && (attrs.funcao || attrs.tipo_dispensa) && (
          <span className="text-[11px] text-[#9aa0a6]">
            {attrs.funcao || '—'} · {TIPO_DISPENSA_LABELS[attrs.tipo_dispensa]?.split('(')[0]?.trim() || attrs.tipo_dispensa || '—'}
          </span>
        )}
        {generating && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[#1a73e8]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Gerando minuta...
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
                    {generating ? 'Redigindo o documento...' : 'Pensando...'}
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
                    setFiles((prev) => [...prev, ...Array.from(e.target.files)]);
                    e.target.value = '';
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
            <span className="text-sm font-medium text-[#202124] truncate flex-1">Minuta</span>
            {generating && (
              <span className="flex items-center gap-1 text-[11px] text-[#1a73e8]">
                <RefreshCw className="w-3 h-3 animate-spin" /> atualizando
              </span>
            )}
            {docHtml && (
              <button
                onClick={() => gerarMinuta({ force: true })}
                disabled={generating}
                title="Gerar uma nova versão (ignora o cache)"
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#dadce0] text-[#3c4043] rounded-lg text-xs font-medium hover:bg-[#f1f3f4] transition-colors disabled:opacity-40"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Regerar
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
            {config?.template_docx_url && (
              <button
                onClick={exportarFiel}
                disabled={!docHtml || !ultimaGeracao || exporting}
                title="Preenche o template .docx oficial — formatação 100% fiel"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0b8043] text-white rounded-lg text-xs font-medium hover:bg-[#0a7038] transition-colors disabled:opacity-40"
              >
                <FileDown className="w-3.5 h-3.5" /> Exportar fiel ao modelo
              </button>
            )}
            <button
              onClick={exportar}
              disabled={!docHtml || !reviewConfirmed || exporting}
              title={!reviewConfirmed ? 'Confirme a revisão antes de exportar' : 'Exportar DOCX'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a73e8] text-white rounded-lg text-xs font-medium hover:bg-[#1557b0] transition-colors disabled:opacity-40"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              {exporting ? 'Exportando...' : 'Exportar DOCX'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 lg:p-8 min-h-0 relative">
            {docHtml ? (
              <DocumentReviewPreview html={docHtml} dimmed={generating} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <FileText className="w-10 h-10 text-[#dadce0] mb-3" />
                <p className="text-sm text-[#5f6368]">A minuta aparecerá aqui.</p>
                <p className="text-xs text-[#9aa0a6] mt-1">Envie a entrevista à esquerda — a minuta será gerada automaticamente.</p>
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