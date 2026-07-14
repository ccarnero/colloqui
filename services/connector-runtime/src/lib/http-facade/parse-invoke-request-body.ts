// Parses/validates the JSON body of `POST /invoke/:connectorId/:endpointId`
// (`manual-loops/connector-invoke-api.md` T02/T04):
// `{ args, mode?: "sync" | "async", idempotencyKey?: string }`.
// `connectorId`/`endpointId` come from the route (they map onto the core's
// `EndpointCallArgs.adapterId`/`endpointId`), `args` supplies the rest
// (method/params/data/headers). `url` is only meaningful for the "no
// endpointId" adapter-base branch of the core — otherwise ignored, same as
// today's `executeWithAdapterEndpoint`. Pure — no `Request`/`Response`
// types, unit-testable without sockets.

import type { EndpointCallArgs } from "@yoizen/shared";
import { validateOutboundUrl } from "../../activities/_shared/validate-outbound-url";
import type { InvokeWebhookTarget } from "../invoke-consumer/types";
import { err, ok, type Result } from "../result";

export interface ParsedInvokeRequest {
  readonly args: EndpointCallArgs;
  readonly mode: "sync" | "async";
  /**
   * Client-supplied dedup key. For `mode: "async"` (T04), the caller MUST
   * reuse the same key across retries of the same logical invocation so
   * `handleInvokeRequest` derives the same `invocationId` — and therefore
   * the same `Nats-Msg-Id` — for every retry, letting JetStream collapse
   * duplicates. `handleInvokeRequest` also honors it for `mode: "sync"`:
   * when present it is used as the audit `invocationId` instead of a
   * generated one, so a caller-supplied key is addressable in audit events
   * regardless of mode (see `handleInvokeRequest`'s invocationId comment).
   */
  readonly idempotencyKey?: string;
  /**
   * `mode: "async"` only (T05): the caller's webhook target for result
   * delivery. Threaded verbatim into the `invoke_requested` envelope
   * payload so the T05 consumer can POST the result there once the core
   * finishes — matches T06's SDK contract
   * `{ mode: "async", webhook?, idempotencyKey? }`, so this body shape
   * needs no separate "register a callback" step. Ignored for
   * `mode: "sync"` — sync callers get the result in the HTTP response body.
   */
  readonly webhook?: InvokeWebhookTarget;
}

/**
 * Validates `raw` (the parsed JSON body) and merges the route's
 * `connectorId`/`endpointId` into the resulting `EndpointCallArgs`.
 * `mode: "sync"` (T02) and `mode: "async"` (T04) are both implemented —
 * any other `mode` is rejected with a 400 instead of silently running sync.
 */
export function parseInvokeRequestBody(
  connectorId: string,
  endpointId: string,
  raw: unknown
): Result<ParsedInvokeRequest, string> {
  if (raw === null || typeof raw !== "object") {
    return err("request body must be a JSON object");
  }
  const body = raw as {
    readonly args?: unknown;
    readonly mode?: unknown;
    readonly idempotencyKey?: unknown;
    readonly webhook?: unknown;
  };

  if (
    body.mode !== undefined &&
    body.mode !== "sync" &&
    body.mode !== "async"
  ) {
    return err(
      `unsupported mode "${String(body.mode)}" — only "sync" and "async" are implemented (manual-loops/connector-invoke-api.md T02/T04)`
    );
  }
  const mode: "sync" | "async" = body.mode === "async" ? "async" : "sync";

  if (
    body.idempotencyKey !== undefined &&
    (typeof body.idempotencyKey !== "string" ||
      body.idempotencyKey.trim().length === 0)
  ) {
    return err("idempotencyKey must be a non-empty string when provided");
  }

  let webhook: InvokeWebhookTarget | undefined;
  if (body.webhook !== undefined) {
    if (mode !== "async") {
      return err('webhook is only valid for mode: "async"');
    }
    if (body.webhook === null || typeof body.webhook !== "object") {
      return err("webhook must be an object with a 'url' field when provided");
    }
    const rawWebhook = body.webhook as { url?: unknown; headers?: unknown };
    if (
      typeof rawWebhook.url !== "string" ||
      rawWebhook.url.trim().length === 0
    ) {
      return err("webhook.url is required and must be a non-empty string");
    }
    // SSRF guard (T05 security fix): reject private/loopback/link-local/
    // cloud-metadata webhook targets at request time so callers get an
    // immediate 400 instead of a silently-dropped delivery later. The
    // delivery activity (`webhook-delivery.ts`) re-validates at dequeue
    // time as defense in depth — the envelope crosses a broker in between.
    const urlCheck = validateOutboundUrl(rawWebhook.url);
    if (!urlCheck.ok) {
      return err(`webhook.url is invalid: ${urlCheck.error}`);
    }
    webhook = {
      url: rawWebhook.url,
      ...(rawWebhook.headers !== undefined && {
        headers: rawWebhook.headers as Record<string, string>,
      }),
    };
  }

  if (body.args === null || typeof body.args !== "object") {
    return err("request body must include an 'args' object");
  }
  const rawArgs = body.args as Record<string, unknown>;

  const method = rawArgs.method;
  if (typeof method !== "string" || method.trim().length === 0) {
    return err("args.method is required and must be a non-empty string");
  }

  const url = typeof rawArgs.url === "string" ? rawArgs.url : "";

  const args: EndpointCallArgs = {
    method,
    url,
    adapterId: connectorId,
    endpointId,
    ...(rawArgs.params !== undefined && {
      params: rawArgs.params as Record<string, unknown>,
    }),
    ...(rawArgs.data !== undefined && { data: rawArgs.data }),
    ...(rawArgs.headers !== undefined && {
      headers: rawArgs.headers as Record<string, string>,
    }),
  };

  return ok({
    args,
    mode,
    ...(body.idempotencyKey !== undefined && {
      idempotencyKey: body.idempotencyKey as string,
    }),
    ...(webhook !== undefined && { webhook }),
  });
}
