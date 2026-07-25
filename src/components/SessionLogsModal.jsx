import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollText } from 'lucide-react';

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

export default function SessionLogsModal({ open, onOpenChange, messages }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" /> Logs da sessão
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-2">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum log registrado nesta sessão.</p>
          ) : messages.map((message, index) => (
            <div key={index} className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-1 flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{message.title || LABELS[message.role] || message.role}</span>
                  {message.category && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{message.category}</span>}
                  {message.status && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{message.status}</span>}
                  {Number.isFinite(message.durationMs) && <span className="text-[10px] text-muted-foreground">{message.durationMs} ms</span>}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{message.timestamp || `#${index + 1}`}</span>
              </div>
              {message.files?.length > 0 && <p className="mb-1 text-xs text-muted-foreground">Arquivos: {message.files.join(', ')}</p>}
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">{message.text || '(sem conteúdo)'}</pre>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}