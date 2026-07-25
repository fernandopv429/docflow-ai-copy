import React from 'react';

// Preview do template .docx já preenchido (gerado por previewTemplate.js).
// O timbrado/layout vem do próprio .docx via mammoth; aqui só apresentamos
// numa "folha" para revisão, com os destaques preenchido × pendente.
export default function DocumentReviewPreview({ html, dimmed }) {
  return (
    <div
      className={`legal-document-page doc-preview mx-auto max-w-3xl bg-card text-card-foreground shadow-sm transition-opacity ${dimmed ? 'opacity-40' : 'opacity-100'}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
