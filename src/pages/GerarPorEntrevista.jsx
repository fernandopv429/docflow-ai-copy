import React from 'react';
import SessionTabs from '@/components/SessionTabs';
import EntrevistaSession from '@/components/EntrevistaSession';
import { useSessions } from '@/hooks/useSessions';

// ============================================================
// Wrapper de Multi-Session.
// Cada aba é uma instância INDEPENDENTE do agente (histórico,
// estado, variáveis, arquivos e rascunho isolados por session_id).
// Sessões inativas permanecem montadas (hidden) para que suas
// operações assíncronas continuem em paralelo sem interferência.
// ============================================================
export default function GerarPorEntrevista() {
  const { sessions, activeId, createSession, closeSession, renameSession, selectSession } = useSessions();

  return (
    <div className="flex flex-col h-full bg-[#f8f9fa]">
      <SessionTabs
        sessions={sessions}
        activeId={activeId}
        onSelect={selectSession}
        onCreate={() => createSession()}
        onClose={closeSession}
        onRename={renameSession}
      />
      <div className="flex-1 min-h-0 flex flex-col">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={s.id === activeId ? 'flex-1 flex min-h-0' : 'hidden'}
          >
            <EntrevistaSession sessionId={s.id} active={s.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}