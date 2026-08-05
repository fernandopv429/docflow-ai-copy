import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Inbox, Loader2, FileText, User, Building2, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// Fila de entrevistas recebidas via webhook (evento "entrevista.salva").
// Lista WebhookEvento pendentes (status 'recebido') e permite abrir para
// gerar a petição na sessão ativa.
export default function FilaWebhooks({ open, onOpenChange, onSelecionar }) {
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const lista = await base44.entities.WebhookEvento.filter(
        { evento_tipo: 'entrevista.salva', status: 'recebido' },
        '-created_date',
        100
      );
      setEventos(lista || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) carregar();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" /> Fila de entrevistas (webhook)
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : eventos.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            Nenhuma entrevista pendente na fila.
          </p>
        ) : (
          <div className="space-y-2">
            {eventos.map((ev) => {
              const d = ev.payload?.data || {};
              return (
                <div
                  key={ev.id}
                  className="border border-border rounded-lg p-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        {d.nome_cliente || '(sem nome)'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                        <Building2 className="h-3 w-3 flex-shrink-0" />
                        {d.reclamadas?.[0]?.razao_social || '—'}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Recebido em {new Date(ev.created_date).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => onSelecionar(ev)} className="flex-shrink-0">
                      <FileText className="h-3.5 w-3.5 mr-1" /> Gerar petição
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}