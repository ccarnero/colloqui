import { sleep } from "./async.utils";
import { TENANT_HEADER } from "./constants";
import type { IMcpUsageEvent } from "./mcp-usage.interfaces";

/** Bounded retry budget — matches the "at most a handful of attempts" shape used elsewhere for non-critical side-effects. */
const MAX_ATTEMPTS = 3;
/** Base backoff delay; attempt N waits `BASE_DELAY_MS * 2 ** (N - 1)`. */
const BASE_DELAY_MS = 200;

/**
 * Retry-capable, still-non-blocking reporter for MCP tool-call usage events
 * (mcp-connections.md §3, metering-foundation.md G4). Posts to
 * `agent-admin-service`'s `POST admin/mcp-servers/usage-events` (the service
 * that owns the `mcp_call_events` table, in the same per-tenant database as
 * `mcp_servers`).
 *
 * Deliberately never awaited by callers and never throws — usage logging is
 * an observability side-effect, not part of the tool-call's own success/
 * failure contract. Mirrors the "failures never propagate" contract used by
 * `connector-runtime`'s `event-publisher.ts` for connector call events.
 *
 * Unlike the original single-shot `fetch`, this now retries up to
 * {@link MAX_ATTEMPTS} times with exponential backoff before giving up —
 * transient network blips or a momentarily unavailable agent-admin-service
 * no longer silently drop the event on the first failure. `event.eventId`
 * is the idempotency key the write endpoint uses (`ON CONFLICT (id) DO
 * NOTHING`), so a retried delivery that actually succeeded server-side but
 * timed out client-side is safe to resend.
 *
 * Importable from any service (agent-ai-service today; connector-runtime's
 * `mcp-call.activity.ts` too) — no dependency on any one service's DB
 * connection or NATS wiring, just `fetch`.
 *
 * @param onError - Called once, with the last error, only after every retry
 *   attempt has been exhausted. When omitted, the final failure is logged via
 *   `console.warn` so it isn't silently swallowed.
 */
export function reportMcpUsageEvent(
  agentAdminServiceUrl: string,
  event: IMcpUsageEvent,
  onError?: (error: unknown) => void
): void {
  void sendWithRetry(agentAdminServiceUrl, event, onError);
}

async function sendWithRetry(
  agentAdminServiceUrl: string,
  event: IMcpUsageEvent,
  onError?: (error: unknown) => void
): Promise<void> {
  let lastError: unknown;

  // The tenant travels only in the header: agent-admin-service's global
  // ValidationPipe runs with forbidNonWhitelisted, and its DTO does not
  // declare tenantId — sending it in the body gets the whole event 400'd.
  const { tenantId, ...body } = event;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(
        `${agentAdminServiceUrl}/admin/mcp-servers/usage-events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [TENANT_HEADER]: tenantId,
          },
          body: JSON.stringify(body),
        }
      );
      if (!response.ok) {
        throw new Error(
          `reportMcpUsageEvent: HTTP ${response.status} from agent-admin-service`
        );
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }

  const message =
    `reportMcpUsageEvent: failed to record MCP usage event ` +
    `(eventId=${event.eventId}, server=${event.serverName}, tool=${event.toolName}) ` +
    `after ${MAX_ATTEMPTS} attempts: ` +
    `${lastError instanceof Error ? lastError.message : String(lastError)}`;

  if (onError) {
    onError(lastError);
  } else {
    console.warn(message);
  }
}
