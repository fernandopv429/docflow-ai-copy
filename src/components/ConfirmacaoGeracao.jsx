import React from 'react';
import { FileDown, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function ConfirmacaoGeracao({ status, disabled, onConfirmar, onRejeitar }) {
  if (status === 'aprovado') {
    return (
      <div className="flex justify-start">
        <div className="flex items-center gap-1.5 px-3.5 py-2 bg-[#e8f5e9] border border-[#0b8043]/30 rounded-2xl rounded-bl-sm text-xs text-[#0b8043]">
          <CheckCircle2 className="w-3.5 h-3.5" /> Geração aprovada — preenchendo a peça...
        </div>
      </div>
    );
  }
  if (status === 'rejeitado') {
    return (
      <div className="flex justify-start">
        <div className="flex items-center gap-1.5 px-3.5 py-2 bg-[#f1f3f4] border border-[#dadce0] rounded-2xl rounded-bl-sm text-xs text-[#5f6368]">
          <X className="w-3.5 h-3.5" /> Geração cancelada.
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] px-3.5 py-2.5 bg-[#fef7e0] border border-[#f9d75b] rounded-2xl rounded-bl-sm text-sm text-[#5f4e00]">
        <div className="flex items-center gap-1.5 font-medium mb-1">
          <AlertTriangle className="w-4 h-4 text-[#b26500]" />
          Gerar a minuta mesmo assim?
        </div>
        <p className="text-xs text-[#5f4e00] mb-2">
          A IA entendeu que há informações pendentes. Você pode gerar agora com os dados disponíveis ou responder as perguntas acima antes de prosseguir.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onConfirmar}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a73e8] text-white rounded-lg text-xs font-medium hover:bg-[#1557b0] transition-colors disabled:opacity-40"
          >
            <FileDown className="w-3.5 h-3.5" /> Gerar agora
          </button>
          <button
            onClick={onRejeitar}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[#dadce0] text-[#3c4043] rounded-lg text-xs font-medium hover:bg-[#f1f3f4] transition-colors disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" /> Não gerar
          </button>
        </div>
      </div>
    </div>
  );
}