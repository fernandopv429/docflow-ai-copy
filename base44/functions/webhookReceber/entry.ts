import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

// ============================================================
// Endpoint público de recebimento de webhooks genéricos.
// Valida um segredo compartilhado (header X-Webhook-Secret ou
// query ?token=) e persiste o payload em WebhookEvento.
// URL: dashboard -> code -> functions -> webhookReceber.
// ============================================================
export default async function(req) {
  try {
    const segredo = secrets.get("WEBHOOK_SECRET");
    if (!segredo) {
      return Response.json({ error: "Webhook não configurado" }, { status: 500 });
    }

    // Validação do segredo compartilhado
    const url = new URL(req.url);
    const tokenHeader = req.headers.get("x-webhook-secret") || req.headers.get("X-Webhook-Secret");
    const tokenQuery = url.searchParams.get("token");
    const token = tokenHeader || tokenQuery;
    if (!token || token !== segredo) {
      return Response.json({ error: "Não autorizado" }, { status: 401 });
    }

    // Parse do corpo (JSON). Aceita qualquer payload genérico.
    let payload = {};
    try {
      const text = await req.text();
      payload = text ? JSON.parse(text) : {};
    } catch (e) {
      // corpo não-JSON: guarda como { raw: "..." }
      payload = { raw: await req.text().catch(() => "") };
    }

    // Metadados do evento (heuristic — funciona para vários provedores)
    const origem = req.headers.get("x-webhook-origin") ||
      payload.source ||
      payload.origem ||
      url.searchParams.get("origem") ||
      "externo";
    const eventoTipo = payload.event ||
      payload.type ||
      payload.evento_tipo ||
      payload.eventType ||
      "desconhecido";
    const eventoId = payload.id ||
      payload.event_id ||
      payload.uuid ||
      payload.eventId ||
      "";

    const ipOrigem = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "";

    // Service role: webhook não tem usuário autenticado
    const base44 = createClientFromRequest(req);
    const registro = await base44.asServiceRole.entities.WebhookEvento.create({
      origem: String(origem).slice(0, 200),
      evento_tipo: String(eventoTipo).slice(0, 200),
      evento_id: String(eventoId).slice(0, 200),
      payload,
      status: "recebido",
      ip_origem: String(ipOrigem).slice(0, 64),
    });

    return Response.json({
      ok: true,
      recebido: true,
      id: registro.id,
      evento_tipo: registro.evento_tipo,
    }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}