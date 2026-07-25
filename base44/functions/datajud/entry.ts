import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { termo, tribunal = 'trt2', size = 5 } = await req.json();
    if (!termo) return Response.json({ hits: [], erro: 'Parâmetro "termo" é obrigatório' });

    const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${tribunal}/_search`;
    const body = JSON.stringify({
      size,
      query: {
        multi_match: {
          query: termo,
          fields: ['assuntos.nome', 'classe.nome', 'movimentos.nome', 'orgaoJulgador.nome'],
        },
      },
    });

    let res;
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==',
          'Content-Type': 'application/json',
        },
        body,
      });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 800));
    }

    if (!res.ok) {
      return Response.json({ hits: [], erro: `DataJud retornou status ${res.status}` });
    }

    const data = await res.json();
    const hits = (data?.hits?.hits || []).map((h) => {
      const s = h._source || {};
      return {
        numero: s.numeroProcesso,
        classe: s.classe?.nome,
        assuntos: (s.assuntos || []).map((a) => a?.nome).filter(Boolean),
        orgao: s.orgaoJulgador?.nome,
        tribunal: s.tribunal,
        data: s.dataAjuizamento,
      };
    });

    return Response.json({ hits });
  } catch (error) {
    return Response.json({ hits: [], erro: error.message });
  }
});