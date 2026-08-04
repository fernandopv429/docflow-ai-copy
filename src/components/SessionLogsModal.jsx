import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollText, Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const LABELS = {
  user: 'Usuário',
  assistant: 'IA',
  tool: 'Ferramenta',
  tool_result: 'Retorno',
  console_log: 'Console',
  console_info: 'Informação',
  console_warn: 'Aviso',
  console_error: 'Erro',
};

function Highlight({ text, term }) {
  if (!term || !term.trim()) return <>{text}</>;
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${safe})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === term.toLowerCase()
      ? <mark key={i} className="bg-yellow-200 text-foreground rounded px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  );
}

export default function SessionLogsModal({ open, onOpenChange, messages }) {
  const [search, setSearch] = useState('');
  const [showOnlyMatches, setShowOnlyMatches] = useState(false);
  const [activeMatch, setActiveMatch] = useState(0);
  const inputRef = useRef(null);

  // Extrai texto pesquisável de cada mensagem
  const searchables = useMemo(() => messages.map((m) => {
    const parts = [
      m.title || LABELS[m.role] || m.role || '',
      m.category || '',
      m.status || '',
      m.text || '',
      m.files?.join(' ') || '',
    ];
    return parts.join(' ').toLowerCase();
  }), [messages]);

  const filtered = useMemo(() => {
    if (!search.trim() || !showOnlyMatches) return messages;
    const term = search.toLowerCase();
    return messages.filter((_, i) => searchables[i].includes(term));
  }, [messages, searchables, search, showOnlyMatches]);

  // Lista de índices (na lista filtrada) que contêm o termo
  const matchIndices = useMemo(() => {
    if (!search.trim()) return [];
    const term = search.toLowerCase();
    return filtered.map((_, i) => i).filter((i) => {
      const origIdx = showOnlyMatches ? filtered[i] : i;
      return searchables[origIdx]?.includes(term);
    });
  }, [filtered, searchables, search, showOnlyMatches]);

  // Ctrl+F abre a busca e foca o input
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setSearch('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Reset do match ativo ao mudar a busca
  useEffect(() => { setActiveMatch(0); }, [search]);

  const scrollToMatch = (idx) => {
    const filteredIdx = matchIndices[idx];
    if (filteredIdx == null) return;
    const el = document.getElementById(`log-row-${filteredIdx}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const nextMatch = () => {
    if (!matchIndices.length) return;
    const n = (activeMatch + 1) % matchIndices.length;
    setActiveMatch(n);
    scrollToMatch(n);
  };

  const prevMatch = () => {
    if (!matchIndices.length) return;
    const n = (activeMatch - 1 + matchIndices.length) % matchIndices.length;
    setActiveMatch(n);
    scrollToMatch(n);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" /> Logs da sessão
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nos logs (Ctrl+F)"
              className="h-9 pl-9 pr-24"
            />
            {search && (
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {matchIndices.length > 0 && (
                  <span className="mr-1 text-[10px] text-muted-foreground">
                    {activeMatch + 1}/{matchIndices.length}
                  </span>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={prevMatch} disabled={!matchIndices.length}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={nextMatch} disabled={!matchIndices.length}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSearch('')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant={showOnlyMatches ? "default" : "outline"}
            onClick={() => setShowOnlyMatches((v) => !v)}
            className="h-9"
          >
            Só matches
          </Button>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search ? 'Nenhum log corresponde à busca.' : 'Nenhum log registrado nesta sessão.'}
            </p>
          ) : filtered.map((message, index) => {
            const origIdx = showOnlyMatches ? filtered[index] : index;
            const isMatch = search.trim() && matchIndices.includes(index);
            const isActive = isMatch && matchIndices[activeMatch] === index;
            return (
              <div
                key={origIdx}
                id={`log-row-${index}`}
                className={`rounded-lg border bg-muted/40 p-3 transition-colors ${isActive ? 'ring-2 ring-yellow-400' : ''}`}
              >
                <div className="mb-1 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground">
                      <Highlight text={message.title || LABELS[message.role] || message.role} term={search} />
                    </span>
                    {message.category && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{message.category}</span>}
                    {message.status && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{message.status}</span>}
                    {Number.isFinite(message.durationMs) && <span className="text-[10px] text-muted-foreground">{message.durationMs} ms</span>}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{message.timestamp || `#${origIdx + 1}`}</span>
                </div>
                {message.files?.length > 0 && <p className="mb-1 text-xs text-muted-foreground">Arquivos: {message.files.join(', ')}</p>}
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                  <Highlight text={message.text || '(sem conteúdo)'} term={search} />
                </pre>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}