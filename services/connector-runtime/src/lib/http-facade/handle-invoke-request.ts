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
  const invocationId = deps.generateInvocationId();
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
