/**
 * The priority-scorer hosted service's HTTP surface (SPEC T05):
 *   - `POST /score`          — parallel connectors.invoke() fan-out + business rules -> { score, tier, reasons }
 *   - `POST /tickets`        — fires the ASYNC create-ticket invoke, returns { invocationId } immediately
 *   - `POST /webhooks/invoke`— receives the async create-ticket confirmation, logs the outcome
 *   - `GET  /health`         — trivial readiness probe for the T05 smoke check
 *
 * Framework-free on purpose: Bun's built-in `Bun.serve()` is enough for this
 * demo-scale service (SPEC "Out of scope": no load/perf testing), keeping
 * the container image small and dependency-free at runtime (the SDK itself
 * has zero runtime dependencies — `sdk/package.json`).
 */
import type { ScorerConfig } from "./config.js";
import type { InvokeAsyncCapableClient } from "./create-ticket.js";
import { type CreateTicketRequest, createTicket } from "./create-ticket.js";
import type { InvokeCapableClient } from "./hubspot-associations.js";
import { err, log, warn } from "./lib/logging.js";
import { scoreContact } from "./score-contact.js";

export type ScorerClient = InvokeCapableClient & InvokeAsyncCapableClient;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isCreateTicketRequest(
  body: Record<string, unknown>
): body is CreateTicketRequest {
  return (
    typeof body.tenant === "string" &&
    typeof body.conversationId === "string" &&
    (typeof body.turn === "string" || typeof body.turn === "number")
  );
}

export function buildHandler(
  client: ScorerClient,
  config: ScorerConfig
): (req: Request) => Promise<Response> {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    log(`request: ${req.method} ${url.pathname}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ status: "ok" });
    }

    if (req.method === "POST" && url.pathname === "/score") {
      const body = await readJsonBody(req);
      const contactId = body.contactId;
      if (typeof contactId !== "string" || contactId.length === 0) {
        warn("POST /score: missing/invalid contactId");
        return jsonResponse({ error: "contactId (string) is required" }, 400);
      }
      try {
        const result = await scoreContact(client, config, contactId);
        return jsonResponse(result);
      } catch (e) {
        // computeScore() never throws — a thrown error here means the
        // fan-out itself blew up unexpectedly (not a HubSpot-status
        // failure, which scoreContact already degrades). Log and still
        // answer with a safe body instead of a 500 crash.
        err(`POST /score: unexpected failure: ${messageOf(e)}`);
        return jsonResponse(
          { score: 0, tier: "standard", reasons: ["crm-unavailable"] },
          200
        );
      }
    }

    if (req.method === "POST" && url.pathname === "/tickets") {
      const body = await readJsonBody(req);
      if (!isCreateTicketRequest(body)) {
        warn("POST /tickets: missing tenant/conversationId/turn");
        return jsonResponse(
          { error: "tenant, conversationId, turn are required" },
          400
        );
      }
      try {
        const result = await createTicket(client, config, body);
        return jsonResponse({ invocationId: result.invocationId }, 202);
      } catch (e) {
        err(`POST /tickets: create-ticket invoke FAILED: ${messageOf(e)}`);
        return jsonResponse({ error: messageOf(e) }, 502);
      }
    }

    if (req.method === "POST" && url.pathname === "/webhooks/invoke") {
      const body = await readJsonBody(req);
      log(`webhooks/invoke: received confirmation: ${JSON.stringify(body)}`);
      return jsonResponse({ received: true });
    }

    warn(`no route: ${req.method} ${url.pathname}`);
    return jsonResponse({ error: "not found" }, 404);
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
