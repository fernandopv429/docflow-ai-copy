import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Inbox, Loader2, FileText, User, Building2, Clock, CheckCircle2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// Fila de petições geradas automaticamente via webhook. Lista
// CasoTrabalhista com analise_json.origem === 'webhook':
// - 'em_analise' = geração em andamento (spinner)
// - 'gerado' = pronta para revisar (abre no painel)
export default function FilaWebhooks({ open, onOpenChange, onSelecionar }) {
  const [casos, setCasos] = useState([]);
  const [loading, setLoading] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const lista = await base44.entities.CasoTrabalhista.list('-created_date', 50);
      setCasos((lista || []).filter((c) => c.analise_json?.origem === 'webhook'));
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
            <Inbox className="h-5 w-5" /> Petições via webhook
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : casos.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            Nenhuma petição recebida via webhook ainda.
          </p>
        ) : (
          <div className="space-y-2">
            {casos.map((c) => {
              const pronto = c.status === 'gerado' && c.analise_json?.dados !== undefined || c.status === 'gerado';
              const gerando = c.status === 'em_analise';
              return (
                <div
                  key={c.id}
                  className="border border-border rounded-lg p-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        {c.recl_nome || c.titulo || '(sem nome)'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                        <Building2 className="h-3 w-3 flex-shrink-0" />
                        {c.recl1_nome || '—'}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(c.created_date).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    {gerando ? (
                      <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#1a73e8] flex-shrink-0">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Gerando...
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => onSelecionar(c)} className="flex-shrink-0">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Revisar
                      </Button>
                    )}
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