// Concrete `DeliverWebhook` implementation (`manual-loops/connector-invoke-api.md`
// T05) — the ONLY place in the invoke-consumer pipeline that POSTs to a
// caller-supplied URL. POSTs the completed `InvocationRecord` as JSON with a
// bounded timeout; NEVER throws (SPEC.md "webhook delivery failure -> warn +
// polling still works" — the caller, `handleInvokeRequestedMessage`, treats
// this as best-effort regardless, but the port itself stays Result-typed per
// the repo's no-throw-for-expected-failures convention).
//
// SSRF: `target.url` is already rejected at request-validation time
// (`parse-invoke-request-body.ts`), but envelopes cross a broker between
// accept and delivery, so `validateOutboundUrl` runs again here as defense
// in depth — never trust that a value that was valid when parked is still
// safe by the time it is dequeued.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { workflowHttpWorkerConfig } from "../../config";
import type { DeliverWebhook } from "../../lib/invoke-consumer/deliver-webhook";
import { err, ok } from "../../lib/result";
import { validateOutboundUrl } from "./validate-outbound-url";

const logger = new PinoLoggerService("connector-runtime-webhook-delivery");

/**
 * Hop-by-hop and identity headers a caller-supplied `webhook.headers` must
 * never override — mirrors the strictest existing precedent in the repo,
 * `agent-ai-service`'s header handling (headers are merged verbatim OVER a
 * fixed `content-type`, never allowed to smuggle transport-level framing).
 * `host`/`content-length`/`transfer-encoding`/`connection` are hop-by-hop
 * and would corrupt or desync the outbound request if caller-controlled;
 * `content-type` is fixed by this activity (`application/json`) and must
 * not be overridden either. `authorization` is intentionally NOT denied —
 * per the SPEC (caller-supplied webhook target), a caller providing their
 * own bearer/basic auth header for their own endpoint is expected and safe.
 */
const DENIED_WEBHOOK_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-connection",
]);

/**
 * Strips hop-by-hop/identity headers from a caller-supplied header map so
 * they can never override the ones this activity sets itself. Logs (warn)
 * when a header is stripped so misbehaving callers are visible in the
 * delivery logs.
 */
function sanitizeWebhookHeaders(
  headers: Record<string, string> | undefined,
  url: string
): Record<string, string> {
  if (!headers) {
    return {};
  }
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (DENIED_WEBHOOK_HEADERS.has(key.toLowerCase())) {
      logger.warn(
        `webhook delivery stripped disallowed header "${key}" url=${url}`
      );
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export const deliverWebhook: DeliverWebhook = async (target, record) => {
  const urlCheck = validateOutboundUrl(target.url);
  if (!urlCheck.ok) {
    logger.warn(
      `webhook delivery blocked url=${target.url}: ${urlCheck.error}`
    );
    return err({
      message: `webhook url "${target.url}" is blocked: ${urlCheck.error}`,
    });
  }

  try {
    const response = await tracedFetch(target.url, {
      method: "POST",
      headers: {
        ...sanitizeWebhookHeaders(target.headers, target.url),
        "content-type": "application/json",
      },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(
        workflowHttpWorkerConfig.invokeWebhookTimeoutMs
      ),
    });

    if (!response.ok) {
      return err({
        message: `webhook responded ${response.status}`,
        status: response.status,
      });
    }
    return ok({ status: response.status });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logger.warn(
      `webhook delivery request failed url=${target.url}: ${message}`
    );
    return err({ message });
  }
};
