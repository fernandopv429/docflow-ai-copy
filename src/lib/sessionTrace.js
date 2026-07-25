export function sessionTrace({ level = 'info', category, title, status, durationMs, details }) {
  console[level]({
    __docflowTrace: true,
    category,
    title,
    status,
    durationMs,
    details,
  });
}

export async function traceAiCall(title, input, call) {
  const startedAt = Date.now();
  sessionTrace({ category: 'IA', title: `${title} — entrada`, status: 'INÍCIO', details: input });
  try {
    const output = await call();
    sessionTrace({
      category: 'IA',
      title: `${title} — saída`,
      status: 'SUCESSO',
      durationMs: Date.now() - startedAt,
      details: output,
    });
    return output;
  } catch (error) {
    sessionTrace({
      level: 'error',
      category: 'IA',
      title: `${title} — erro`,
      status: 'ERRO',
      durationMs: Date.now() - startedAt,
      details: { message: error.message, stack: error.stack },
    });
    throw error;
  }
}