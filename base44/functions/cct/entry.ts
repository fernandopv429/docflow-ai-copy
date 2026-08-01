import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Consulta semântica de Convenções Coletivas (cct-api / pgvector).
// A chave fica em SECRET (env CCT_API_KEY) — nunca no frontend.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const apiKey = Deno.env.get('CCT_API_KEY');
    if (!apiKey) return Response.json({ resultados: [], erro: 'CCT_API_KEY não configurada no servidor' });

    const { pergunta, categoria, municipio, data_fato, limite = 6 } = await req.json();
    if (!pergunta) return Response.json({ resultados: [], erro: 'Parâmetro "pergunta" é obrigatório' });

    const body: Record<string, unknown> = { pergunta, limite };
    if (categoria) body.categoria = categoria;
    if (municipio) body.municipio = municipio;
    if (data_fato) body.data_fato = data_fato;

    let res;
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch('https://ccts.nexusdevhub.com/consultar-cct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(body),
      });
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 800));
    }

    if (!res.ok) return Response.json({ resultados: [], erro: `CCT API retornou status ${res.status}` });

    const data = await res.json();
    return Response.json({ resultados: data?.resultados || [], total: data?.total || 0 });
  } catch (error) {
    return Response.json({ resultados: [], erro: error.message });
  }
});