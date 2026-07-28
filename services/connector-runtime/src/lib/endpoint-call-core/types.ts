import type { EventCausalContext } from "@yoizen/shared";
import type {
  EndpointCacheResult,
  IHttpCallResult,
} from "../../activities/_shared/http-call-with-retry";

/** Normalized status/body/headers shape returned by every execution branch. */
export type IEndpointCallResult = IHttpCallResult;

/**
 * Port for the `connector.endpoint_call.completed.v1` audit event. The core
 * calls this unconditionally on every successful branch so breaker/cache/
 * audit governance stays inside the pure lib (`manual-loops/connector-invoke-api.md`
 * T01) — the concrete NATS-backed implementation
 * (`activities/_shared/event-publisher.ts`'s `publishEndpointCallEvent`) is
 * injected by entrypoints. This keeps the core's import graph free of `nats`
 * while preserving fire-and-forget semantics: implementations MUST NOT
 * throw synchronously and MUST swallow async publish failures themselves.
 */
export type EndpointCallEventSink = (
  payload: IEndpointCallEventPayload
) => void;

/** Payload shape published as the `connector.endpoint_call.completed.v1` event. */
export interface IEndpointCallEventPayload {
  readonly tenantId: string;
  readonly adapterId: string;
  readonly endpointId: string | null;
  readonly method: string;
  readonly resolvedUrl: string;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: EndpointCacheResult;
  readonly requestHeaders?: Record<string, string>;
  readonly requestBody?: string;
  readonly responseHeaders?: Record<string, string>;
  readonly responseBody?: string;
  readonly cacheKey?: string;
  readonly cacheTtlSeconds?: number;
  /**
   * Set by standalone (non-workflow) callers — today the HTTP facade
   * (`src/http-main.ts`, `manual-loops/connector-invoke-api.md` T02). When
   * present, `event-publisher.ts`'s `emit()` uses it to build the envelope
   * `resource` (`invocation/${invocationId}`) instead of the default
   * `adapter/${adapterId}`, so a standalone invocation's audit event is
   * addressable by `invocationId` even though it has no `causal` context to
   * join (root correlation, per SPEC.md T02).
   */
  readonly invocationId?: string;
  /**
   * Explicit envelope `resource` override. Set by callers that don't fit the
   * `invocation/${invocationId}` / `adapter/${adapterId}` shapes the sink
   * defaults to — e.g. `service-call.activity.ts`'s `service/<serviceName>`
   * (`manual-loops/connectors/connection-call-inspector.md` T01, decision 7)
   * and the raw no-adapter HTTP branch's `raw/<host>` (T02). When present,
   * `event-publisher.ts`'s `emit()` uses it verbatim instead of deriving a
   * resource from `invocationId`/`adapterId`.
   */
  readonly resource?: string;
  /**
   * Causal context from the workflow's `endpointCall`/`serviceCall` action,
   * mirroring `mcp-call.activity.ts`'s `causal` threading (metering-foundation.md
   * G5). When present, the published envelope's `correlation_id`/`causation_id`/
   * `transport.depth` join the run's causal chain instead of becoming a root
   * event. Absent `causal` preserves today's behavior (random correlation,
   * null causation, depth 0).
   */
  readonly causal?: EventCausalContext;
}

/** No-op default sink: keeps `publish` optional for pure-core callers/tests
 * (e.g. `endpoint-call-core.spec.ts`) without ever importing `nats`. Real
 * entrypoints (the Temporal activity wrapper) always inject the real sink. */
export const noopEndpointCallEventSink: EndpointCallEventSink = () => {};

/**
 * Discriminated error union for the endpoint-call core. Never thrown across
 * the lib boundary (SPEC.md code-style contract) — entrypoints (today: the
 * Temporal activity wrapper) map each variant to their own error type
 * (`ApplicationFailure` for Temporal).
 */
export type EndpointCallError =
  | {
      readonly kind: "breaker_open";
      readonly key: string;
      readonly status: string;
      readonly reason: string;
      readonly cooldownMs: number;
    }
  | {
      readonly kind: "invalid_args";
      readonly code: "INVALID_ENDPOINT_CALL_ARGS" | "INVALID_ENDPOINT_CALL_URL";
      readonly message: string;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly kind: "http_error";
      readonly message: string;
      readonly cause: unknown;
    }
  | {
      readonly kind: "timeout";
      readonly message: string;
      readonly cause: unknown;
    };
