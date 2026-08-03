import { useState, useCallback, useEffect } from 'react';

// ============================================================
// Gerenciador de múltiplas sessões independentes.
// Cada sessão possui histórico, estado, variáveis e contexto
// totalmente isolados (cada uma é uma instância independente do
// agente). A lista de sessões é persistida em localStorage.
// ============================================================

const STORAGE_KEY = 'docflow:sessions';

function genId() {
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useSessions() {
  const [sessions, setSessions] = useState(() => {
    const list = loadSessions();
    return list.length ? list : [{ id: genId(), title: 'Sessão 1', createdAt: Date.now() }];
  });
  const [activeId, setActiveId] = useState(() => {
    const list = loadSessions();
    if (list.length) return list[0].id;
    return null; // será resolvido pelo estado sessions no primeiro render
  });

  // Resolve activeId quando não veio do storage (primeira sessão criada acima)
  useEffect(() => {
    if (!activeId && sessions.length) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  const createSession = useCallback(() => {
    const id = genId();
    const n = sessions.length + 1;
    setSessions((prev) => [...prev, { id, title: `Sessão ${n}`, createdAt: Date.now() }]);
    setActiveId(id);
    return id;
  }, [sessions.length]);

  const closeSession = useCallback(
    (id) => {
      // Limpa o estado persistido da sessão encerrada
      localStorage.removeItem(`docflow:entrevista-texto:${id}`);
      localStorage.removeItem(`docflow:caso-rascunho-id:${id}`);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (next.length === 0) {
          const fresh = { id: genId(), title: 'Sessão 1', createdAt: Date.now() };
          setActiveId(fresh.id);
          return [fresh];
        }
        setActiveId((cur) => (cur === id ? next[next.length - 1].id : cur));
        return next;
      });
    },
    []
  );

  const renameSession = useCallback((id, title) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const selectSession = useCallback((id) => setActiveId(id), []);

  return { sessions, activeId, createSession, closeSession, renameSession, selectSession };
}