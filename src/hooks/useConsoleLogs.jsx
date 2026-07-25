import { useEffect, useState } from 'react';

const formatValue = (value) => {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

export default function useConsoleLogs() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const methods = ['log', 'info', 'warn', 'error'];
    const originals = Object.fromEntries(methods.map((method) => [method, console[method]]));
    methods.forEach((method) => {
      console[method] = (...args) => {
        originals[method](...args);
        const trace = args.length === 1 && args[0]?.__docflowTrace ? args[0] : null;
        setLogs((current) => [...current, trace ? {
          role: `console_${method}`,
          title: trace.title,
          text: formatValue(trace.details),
          category: trace.category,
          status: trace.status,
          durationMs: trace.durationMs,
          timestamp: new Date().toLocaleTimeString('pt-BR', { fractionalSecondDigits: 3 }),
        } : {
          role: `console_${method}`,
          title: `Console ${method}`,
          text: args.map(formatValue).join(' '),
          timestamp: new Date().toLocaleTimeString('pt-BR', { fractionalSecondDigits: 3 }),
        }]);
      };
    });
    return () => methods.forEach((method) => { console[method] = originals[method]; });
  }, []);

  return logs;
}