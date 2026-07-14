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
import type { ParkInvocationResult } from "../invoke-consumer/park-invocation-result";
import type { Result } from "../result";
import { checkRateLimit, type RateLimitState } from "./check-rate-limit";
import { checkTenantHeader } from "./check-tenant-header";
import { mapEndpointCallErrorToHttpResponse } from "./map-endpoint-call-error-to-http-response";
import { parseInvokeRequestBody } from "./parse-invoke-request-body";
import type { PublishInvokeRequest } from "./publish-invoke-request";

/**
 * SPEC.md T05 human boundary: "Redis result TTL: config-driven, default
 * 15m." Used as the fallback when `deps.resultTtlSeconds` is not supplied
 * (real entrypoint always wires `workflowHttpWorkerConfig.invocationResultTtlSeconds`).
 */
const DEFAULT_RESULT_TTL_SECONDS = 15 * 60;

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
  /**
   * Injected result-parking port for `mode: "async"` (T05; real:
   * `parkInvocationResult` from `src/activities/_shared/invocation-store.ts`).
   * Optional so `mode: "sync"` and pre-T05 async tests never need to stub
   * it. Writes a `status: "pending"` marker right after a successful
   * publish so `GET /invocations/:id` can tell "queued" apart from
   * "unknown/expired" (both otherwise read as a Redis cache-miss — see
   * `invoke-consumer/types.ts`'s `InvocationRecord` doc comment).
   * Best-effort: a parking failure here is warned and NEVER changes the
   * `202` response — the async accept already succeeded on the broker.
   */
  readonly parkPendingInvocation?: ParkInvocationResult;
  readonly resultTtlSeconds?: number;
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
      ...(parsed.value.webhook !== undefined && {
        webhook: parsed.value.webhook,
      }),
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

    // Best-effort "pending" marker (T05) so GET /invocations/:id can answer
    // "queued" instead of "unknown/expired" before the consumer completes.
    // Never affects the 202 response — the broker already accepted the
    // invoke_requested publish, which is the actual contract of this call.
    if (deps.parkPendingInvocation) {
      try {
        await deps.parkPendingInvocation(
          {
            status: "pending",
            tenantId,
            invocationId,
            acceptedAt: new Date().toISOString(),
          },
          deps.resultTtlSeconds ?? DEFAULT_RESULT_TTL_SECONDS
        );
      } catch (cause) {
        warn(
          `invoke PENDING PARK FAILED invocationId=${invocationId} tenant=${tenantId} — ${cause instanceof Error ? cause.message : String(cause)} (202 already returned; GET may read as expired/unknown until the consumer completes it)`
        );
      }
    }

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
