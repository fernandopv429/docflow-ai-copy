import React from 'react';
import { Wrench } from 'lucide-react';

export default function ToolTraceMessage({ message }) {
  const isResult = message.role === 'tool_result';

  return (
    <div className="flex justify-start">
      <div className={`max-w-[94%] border text-muted-foreground ${isResult ? 'rounded-lg bg-card px-3 py-2' : 'rounded-full bg-muted px-3 py-1'}`}>
        <div className="flex items-start gap-1.5">
          <Wrench className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary" />
          <div className="min-w-0">
            {message.title && <p className="mb-1 text-[11px] font-semibold text-foreground">{message.title}</p>}
            <pre className="whitespace-pre-wrap break-words font-body text-[11px] leading-relaxed">{message.text}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}