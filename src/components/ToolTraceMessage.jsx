import React from 'react';
import { Wrench, Braces } from 'lucide-react';

export default function ToolTraceMessage({ message }) {
  const isResult = message.role === 'tool_result';
  const isJson = isResult && (message.text?.trimStart().startsWith('{') || message.text?.trimStart().startsWith('['));

  return (
    <div className="flex justify-start">
      <div className={`max-w-[94%] border text-muted-foreground ${isResult ? 'rounded-lg bg-card px-3 py-2' : 'rounded-full bg-muted px-3 py-1'}`}>
        <div className="flex items-start gap-1.5">
          {isJson ? (
            <Braces className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#1a73e8]" />
          ) : (
            <Wrench className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary" />
          )}
          <div className="min-w-0 w-full">
            {message.title && (
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-foreground">{message.title}</span>
                {isJson && (
                  <span className="rounded bg-[#1a73e8]/10 px-1 py-0.5 text-[9px] font-medium text-[#1a73e8]">JSON</span>
                )}
              </div>
            )}
            {isJson ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed bg-[#f8f9fa] rounded-md p-2 border border-[#e8eaed] text-[#3c4043] overflow-x-auto">{message.text}</pre>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-body text-[11px] leading-relaxed">{message.text}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}