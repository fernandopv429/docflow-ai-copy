import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Consulta de CEP (ViaCEP, com fallback BrasilAPI) — via backend, no mesmo
// padrão do datajud/cct.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ erro: 'Unauthorized' }, { status: 401 });

    const { cep } = await req.json();
    const digits = (cep || '').replace(/\D/g, '');
    if (digits.length !== 8) {
      return Response.json({ cep, erro: 'CEP inválido (precisa de 8 dígitos)' });
    }
    const fmt = `${digits.slice(0, 5)}-${digits.slice(5)}`;

    // 1) ViaCEP (traz município + código IBGE)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (res.ok) {
        const d = await res.json();
        if (!d.erro) {
          return Response.json({
            cep: fmt,
            logradouro: d.logradouro || '',
            bairro: d.bairro || '',
            municipio: d.localidade || '',
            uf: d.uf || '',
            ibge: d.ibge || '',
          });
        }
      }
    } catch (e) {
      // segue para o fallback
    }

    // 2) Fallback BrasilAPI
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${digits}`);
      if (res.ok) {
        const d = await res.json();
        return Response.json({
          cep: fmt,
          logradouro: d.street || '',
          bairro: d.neighborhood || '',
          municipio: d.city || '',
          uf: d.state || '',
          ibge: '',
        });
      }
    } catch (e) {
      // ignora
    }

    return Response.json({ cep: fmt, erro: 'não encontrado' });
  } catch (error) {
    return Response.json({ erro: error.message });
  }
});