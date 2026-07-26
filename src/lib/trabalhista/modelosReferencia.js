// ============================================================
// Barrel do domínio trabalhista — re-exporta os módulos coesos.
// Mantém compatibilidade com imports existentes de
// '@/lib/trabalhista/modelosReferencia'. Prefira importar do
// módulo específico em código novo.
// ============================================================
export * from './consultas';       // config + CNPJ + CEP + DataJud
export * from './matching';        // pontuação/ranking de modelos de referência
export * from './modelosImport';   // anonimização + importação de .docx
export * from './entrevista';      // chat da entrevista (conversarEntrevista)
export * from './geracao';         // gerarDadosPeca (motor determinístico)
export * from './auditoria';       // verificarCoerencia
