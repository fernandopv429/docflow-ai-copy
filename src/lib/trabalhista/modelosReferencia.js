// ============================================================
// Barrel do domínio trabalhista — re-exporta os módulos coesos.
// Mantém compatibilidade com imports existentes de
// '@/lib/trabalhista/modelosReferencia'. Prefira importar do
// módulo específico em código novo.
// ============================================================
export * from './consultas';       // config + CNPJ + CEP + DataJud
export * from './matching';        // pontuação/ranking de modelos de referência
export * from './modelosImport';   // anonimização + importação de .docx
export * from './entrevista';      // chat da entrevista (conversarEntrevista) + via consolidada
export * from './geracao';         // gerarDadosPeca (motor determinístico)
export * from './auditoria';       // verificarCoerencia

// O entrevista.js consolidado reexporta funções que também vivem nos módulos
// especializados (consultas, matching, modelosImport, auditoria). Com `export *`
// nomes em conflito ficam ambíguos e SÃO OMITIDOS do barrel — o que quebraria os
// imports das páginas. As reexportações explícitas abaixo resolvem a ambiguidade,
// preferindo os módulos originais para preservar os contratos (assinaturas) que
// as páginas já consomem. A via consolidada do entrevista.js fica disponível por
// import direto de './entrevista' para uso futuro.
export { verificarCoerencia } from './auditoria';
export { anonimizarTexto, resumirDiferencial, extrairTextoDocx, classificarTextoModelo } from './modelosImport';