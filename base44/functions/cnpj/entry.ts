import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Consulta de CNPJ na Receita Federal (BrasilAPI) — via backend para evitar
// CORS/dependência do navegador, no mesmo padrão do datajud/cct.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ erro: 'Unauthorized' }, { status: 401 });

    const { cnpj } = await req.json();
    const digits = (cnpj || '').replace(/\D/g, '');
    if (digits.length !== 14) {
      return Response.json({ cnpj, erro: 'CNPJ inválido (precisa de 14 dígitos)' });
    }
    const fmt = digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
    if (res.status === 404) return Response.json({ cnpj: fmt, erro: 'não encontrado na Receita' });
    if (!res.ok) return Response.json({ cnpj: fmt, erro: `erro HTTP ${res.status}` });

    const d = await res.json();
    const cep = (d.cep || '').replace(/\D/g, '');
    const endereco = [
      `${d.descricao_tipo_de_logradouro || ''} ${d.logradouro || ''}`.trim(),
      d.numero,
      d.complemento,
      d.bairro,
      [d.municipio, d.uf].filter(Boolean).join('/'),
    ].filter(Boolean).join(', ');

    return Response.json({
      cnpj: fmt,
      razao_social: d.razao_social || '',
      endereco,
      cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep,
      situacao: d.descricao_situacao_cadastral || '',
    });
  } catch (error) {
    return Response.json({ erro: error.message });
  }
});