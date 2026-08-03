import React, { useState } from 'react';
import { Plus, X, MessageSquare, Check } from 'lucide-react';

// ============================================================
// Barra de abas de sessões — criar, listar, selecionar,
// renomear e encerrar sessões independentes.
// ============================================================
export default function SessionTabs({ sessions, activeId, onSelect, onCreate, onClose, onRename }) {
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditText(s.title);
  };

  const commitEdit = () => {
    if (editingId && editText.trim()) onRename(editingId, editText.trim());
    setEditingId(null);
  };

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#dadce0] bg-[#f1f3f4] overflow-x-auto flex-shrink-0 scrollbar-thin">
      {sessions.map((s) => (
        <div
          key={s.id}
          onClick={() => onSelect(s.id)}
          onDoubleClick={() => startEdit(s)}
          className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs cursor-pointer whitespace-nowrap select-none ${
            s.id === activeId
              ? 'bg-white text-[#1a73e8] border border-b-white border-[#dadce0] font-medium'
              : 'text-[#5f6368] hover:bg-white/60 border border-transparent'
          }`}
        >
          <MessageSquare className="w-3 h-3 flex-shrink-0" />
          {editingId === s.id ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onBlur={commitEdit}
                className="w-24 px-1 py-0 text-xs border border-[#1a73e8] rounded outline-none"
              />
              <button
                onClick={(e) => { e.stopPropagation(); commitEdit(); }}
                className="text-[#0b8043] hover:scale-110 transition-transform"
              >
                <Check className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <span className="max-w-[120px] truncate">{s.title}</span>
          )}
          {sessions.length > 1 && editingId !== s.id && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
              className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
              title="Encerrar sessão"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onCreate}
        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#1a73e8] hover:bg-white/60 rounded-lg whitespace-nowrap flex-shrink-0"
        title="Nova sessão"
      >
        <Plus className="w-3.5 h-3.5" /> Nova
      </button>
    </div>
  );
}