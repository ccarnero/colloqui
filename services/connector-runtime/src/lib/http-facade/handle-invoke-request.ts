// Orchestrates `POST /invoke/:connectorId/:endpointId` (the sync HTTP
// invoke facade, `manual-loops/connector-invoke-api.md` T02): tenant guard,
// rate limit, body validation, then the core execution — WITHOUT touching
// `Bun.serve`/`Request`/`Response` directly. Same injected-I/O shape as
// `tracking-ingester-service`'s `handle-events-request.ts`: the actual
// `Bun.serve` binding and JSON body parsing are the only I/O, left to
// `src/http-main.ts`.

import { TENANT_HEADER } from "@yoizen/shared";
import type {
  EndpointCallError,
  EndpointCallEventSink,
  IEndpointCallResult,
} from "../endpoint-call-core";
import { executeEndpointCallCore } from "../endpoint-call-core";
import type { Result } from "../result";
import { checkRateLimit, type RateLimitState } from "./check-rate-limit";
import { checkTenantHeader } from "./check-tenant-header";
import { mapEndpointCallErrorToHttpResponse } from "./map-endpoint-call-error-to-http-response";
import { parseInvokeRequestBody } from "./parse-invoke-request-body";
import type { PublishInvokeRequest } from "./publish-invoke-request";

export interface HandleInvokeRequestDeps {
  readonly tenantHeader: string | null;
  readonly connectorId: string;
  readonly endpointId: string;
  readonly rawBody: unknown;
  readonly rateLimitState: RateLimitState;
  readonly rateLimitConfig: {
    readonly limit: number;
    readonly windowMs: number;
  };
  /** Generates the `invocationId` for this standalone invocation (T02: root correlation, no workflow executionId). */
  readonly generateInvocationId: () => string;
  /** Injected so tests can stub the breaker/cache/HTTP pipeline (mirrors `executeEndpointCallCore`'s signature). */
  readonly executeCore?: typeof executeEndpointCallCore;
  /** Injected audit-event sink (real: `publishEndpointCallEvent`). */
  readonly publish: EndpointCallEventSink;
  /**
   * Injected `invoke_requested` transport publisher for `mode: "async"`
   * (T04; real: `publishInvokeRequestEvent`). Optional so `mode: "sync"`
   * unit tests never need to stub it — `handleInvokeRequest` only calls it
   * on the async branch.
   */
  readonly publishInvokeRequest?: PublishInvokeRequest;
  readonly log?: (message: string) => void;
  readonly warn?: (message: string) => void;
}

export type HandleInvokeRequestResult =
  | {
      readonly status: 400;
      readonly body: { readonly error: string };
    }
  | {
      readonly status: 429;
      readonly body: {
        readonly error: "rate_limited";
        readonly message: string;
        readonly resetSeconds: number;
      };
    }
  | {
      readonly status: 200;
      readonly body: { readonly invocationId: string } & IEndpointCallResult;
    }
  | {
      readonly status: 400 | 502 | 503 | 504;
      readonly body: { readonly invocationId: string } & ReturnType<
        typeof mapEndpointCallErrorToHttpResponse
      >["body"];
    }
  | {
      // T04 async accept response.
      readonly status: 202;
      readonly body: { readonly invocationId: string };
    }
  | {
      // T04: the invoke_requested subject publish itself failed (broker
      // down, or — per the fail-loud contract — not stream-bound). Never
      // silently swallowed; surfaced as a retryable 503.
      readonly status: 503;
      readonly body: { readonly invocationId: string; readonly error: string };
    };

/**
 * Handles one sync invoke request: 400 when the tenant header is missing
 * (gateway proxy always sets it), 429 when the per-tenant rate limit is
 * exceeded, 400 when the body fails validation, otherwise runs the pure
 * core (breaker/cache/audit governed identically to the Temporal activity)
 * and maps its `Result` onto the HTTP response.
 */
export async function handleInvokeRequest(
  deps: HandleInvokeRequestDeps
): Promise<HandleInvokeRequestResult> {
  const log = deps.log ?? ((): void => {});
  const warn = deps.warn ?? ((): void => {});
  const execute = deps.executeCore ?? executeEndpointCallCore;

  const tenantGuard = checkTenantHeader(deps.tenantHeader);
  if (!tenantGuard.ok) {
    warn(
      `invoke REJECTED connector=${deps.connectorId} endpoint=${deps.endpointId} — missing ${TENANT_HEADER} header`
    );
    return { status: tenantGuard.status, body: tenantGuard.body };
  }
  const { tenantId } = tenantGuard;

  const rateLimit = checkRateLimit(
    deps.rateLimitState,
    tenantId,
    deps.rateLimitConfig
  );
  if (!rateLimit.allowed) {
    warn(
      `invoke RATE LIMITED tenant=${tenantId} connector=${deps.connectorId} endpoint=${deps.endpointId} limit=${rateLimit.limit} resetSeconds=${rateLimit.resetSeconds}`
    );
    return {
      status: 429,
      body: {
        error: "rate_limited",
        message: `Rate limit of ${rateLimit.limit} requests exceeded`,
        resetSeconds: rateLimit.resetSeconds,
      },
    };
  }

  const parsed = parseInvokeRequestBody(
    deps.connectorId,
    deps.endpointId,
    deps.rawBody
  );
  if (!parsed.ok) {
    warn(
      `invoke REJECTED tenant=${tenantId} connector=${deps.connectorId} endpoint=${deps.endpointId} — ${parsed.error}`
    );
    return { status: 400, body: { error: parsed.error } };
  }

  // Standalone (non-workflow) invocation: generated here even in sync mode
  // (SPEC.md T02) so the audit event is addressable by invocationId and
  // starts a root correlation (no `causal` — no workflow executionId to join).
  // For `mode: "async"` (T04), a client-supplied `idempotencyKey` is reused
  // AS the invocationId so retries of the same logical invocation collapse
  // onto the same `Nats-Msg-Id` (JetStream dedup, `invoke-request-publisher.ts`).
  const invocationId =
    parsed.value.idempotencyKey ?? deps.generateInvocationId();

  if (parsed.value.mode === "async") {
    log(
      `invoke START invocationId=${invocationId} tenant=${tenantId} connector=${deps.connectorId} endpoint=${deps.endpointId} mode=async`
    );
    if (!deps.publishInvokeRequest) {
      // Programmer error, not a runtime/user condition: the entrypoint MUST
      // wire `publishInvokeRequest` before exposing `mode: "async"`. Fail
      // loud rather than silently degrading to a no-op accept.
      throw new Error(
        "handleInvokeRequest: mode=async requires deps.publishInvokeRequest to be wired by the entrypoint"
      );
    }
    const published = await deps.publishInvokeRequest({
      tenantId,
      invocationId,
      connectorId: deps.connectorId,
      endpointId: deps.endpointId,
      args: parsed.value.args,
    });
    if (!published.ok) {
      warn(
        `invoke ASYNC PUBLISH FAILED invocationId=${invocationId} tenant=${tenantId} connector=${deps.connectorId} endpoint=${deps.endpointId} — ${published.error.message}`
      );
      return {
        status: 503,
        body: { invocationId, error: published.error.message },
      };
    }
    log(
      `invoke ACCEPTED invocationId=${invocationId} tenant=${tenantId} connector=${deps.connectorId} endpoint=${deps.endpointId} subject=${published.value.subject}`
    );
    return { status: 202, body: { invocationId } };
  }

  log(
    `invoke START invocationId=${invocationId} tenant=${tenantId} connector=${deps.connectorId} endpoint=${deps.endpointId} mode=sync`
  );

  const result: Result<IEndpointCallResult, EndpointCallError> = await execute(
    parsed.value.args,
    tenantId,
    undefined,
    deps.publish,
    undefined,
    invocationId
  );

  if (!result.ok) {
    const mapped = mapEndpointCallErrorToHttpResponse(result.error);
    warn(
      `invoke FAILED invocationId=${invocationId} tenant=${tenantId} connector=${deps.connectorId} endpoint=${deps.endpointId} kind=${result.error.kind} status=${mapped.status}`
    );
    return {
      status: mapped.status,
      body: { invocationId, ...mapped.body },
    };
  }

  log(
    `invoke OK invocationId=${invocationId} tenant=${tenantId} connector=${deps.connectorId} endpoint=${deps.endpointId} status=${result.value.status}`
  );
  return { status: 200, body: { invocationId, ...result.value } };
}
