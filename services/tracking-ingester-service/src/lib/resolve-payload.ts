// Claim-check resolution at ingest (manual-loops/payload-capture.md T02).
//
// When `is_claim_check` is true, the ingester resolves the out-of-band
// payload BEFORE persisting so it is captured while the Redis/Object-Store
// TTL still holds it. This module wraps `resolveClaimCheckEnvelope`
// (`@yoizen/database`, packages/database/src/claim-check.ts) — REUSED, never
// reimplemented — with:
//   - a bounded timeout (`CLAIM_CHECK_RESOLVE_TIMEOUT_MS`, default 2000ms) so
//     a slow/stuck Object Store fetch never blocks ingestion beyond budget;
//   - verbose attempt/outcome/duration logging (`logWithEnvelope`);
//   - a Result-shaped outcome that NEVER throws. Every failure mode (expired
//     ref / blob not found, malformed ref, cache/object-store unreachable,
//     timeout) is reported as `{ status: "unresolved", envelope, reason }`
//     carrying the ORIGINAL slim envelope untouched, so the caller persists
//     it exactly as it does today (`payload_status = "unresolved"`) and NEVER
//     naks the message for a resolution failure (SPEC.md constraint —
//     ingestion latency is the priority).
//
// This file has ZERO NATS/Object-Store I/O of its own — the actual
// resolution mechanism is injected via `deps.resolve`. `main.ts` binds the
// real capability: `(envelope) => resolveClaimCheckEnvelope(envelope, getStore)`
// where `getStore` opens the NATS Object Store bucket (mirrors
// `MultiTenantConsumerManager.getClaimCheckStore`).

import type { PinoLoggerService } from "@yoizen/observability";
import { logWithEnvelope } from "@yoizen/observability";
import type { EventEnvelope } from "@yoizen/shared";

/** Default resolution budget — bounded so a slow/stuck fetch never blocks ingestion. */
export const DEFAULT_CLAIM_CHECK_RESOLVE_TIMEOUT_MS = 2000;

/** Minimal logger surface this stage needs (a `PinoLoggerService` satisfies it). */
export type ResolvePayloadLogger = Pick<
  PinoLoggerService,
  "log" | "warn" | "error" | "debug"
>;

const NOOP_LOGGER: ResolvePayloadLogger = {
  log() {},
  warn() {},
  error() {},
  debug() {},
};

export interface ResolvePayloadDeps {
  /**
   * The injected resolution capability. `main.ts` binds this to
   * `(envelope) => resolveClaimCheckEnvelope(envelope, getStore)` — this
   * module never touches NATS/the Object Store itself.
   */
  readonly resolve: (envelope: EventEnvelope) => Promise<EventEnvelope>;
  /** @default DEFAULT_CLAIM_CHECK_RESOLVE_TIMEOUT_MS */
  readonly timeoutMs?: number;
  /** Verbose structured logger. @default no-op */
  readonly logger?: ResolvePayloadLogger;
  /** Monotonic clock for duration measurement (injectable for tests). @default performance.now */
  readonly now?: () => number;
}

export type ResolvePayloadOutcome =
  | { readonly status: "resolved"; readonly envelope: EventEnvelope }
  | {
      readonly status: "unresolved";
      readonly envelope: EventEnvelope;
      readonly reason: string;
    };

/** Raised internally when `deps.resolve` does not settle within `timeoutMs`. */
class ClaimCheckTimeoutError extends Error {}

/**
 * Resolves a claim-check envelope's out-of-band payload before persistence.
 *
 * NEVER throws: any failure is reported as `{ status: "unresolved" }`
 * carrying the original slim envelope untouched — the caller persists it
 * exactly as today's slim shape and never naks the message for a resolution
 * failure.
 */
export async function resolvePayload(
  envelope: EventEnvelope,
  deps: ResolvePayloadDeps
): Promise<ResolvePayloadOutcome> {
  const logger = deps.logger ?? NOOP_LOGGER;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_CLAIM_CHECK_RESOLVE_TIMEOUT_MS;
  const clock = deps.now ?? (() => performance.now());
  const payloadRef = envelope.data?.payload_ref ?? null;

  logWithEnvelope(
    logger,
    envelope,
    "tracking.claim_check.resolve.attempt",
    `attempting claim-check resolution payload_ref=${payloadRef ?? "MISSING"} timeout_ms=${timeoutMs}`
  );

  const startedAt = clock();
  try {
    const resolved = await withTimeout(deps.resolve(envelope), timeoutMs);
    const durationMs = clock() - startedAt;
    logWithEnvelope(
      logger,
      envelope,
      "tracking.claim_check.resolve.success",
      `resolved claim-check payload_ref=${payloadRef} duration_ms=${durationMs.toFixed(1)}`
    );
    return { status: "resolved", envelope: resolved };
  } catch (error) {
    const durationMs = clock() - startedAt;
    const reason = describeError(error);
    logWithEnvelope(
      logger,
      envelope,
      "tracking.claim_check.resolve.failed",
      `claim-check resolution FAILED payload_ref=${payloadRef ?? "MISSING"} reason="${reason}" duration_ms=${durationMs.toFixed(1)} — persisting slim envelope, payload_status=unresolved`,
      "warn"
    );
    return { status: "unresolved", envelope, reason };
  }
}

/**
 * Races `promise` against a timer; the timer is cleared on either settle path
 * so a resolved/rejected `promise` never leaves a dangling handle.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ClaimCheckTimeoutError(`resolution exceeded ${ms}ms`));
    }, ms);
    // Node/Bun timer — unref so a pending timeout never keeps the process
    // (or the test runner) alive after the promise settles first.
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Human-readable failure reason for the warn log — never throws itself. */
function describeError(error: unknown): string {
  if (error instanceof ClaimCheckTimeoutError) {
    return `timeout: ${error.message}`;
  }
  // `ClaimCheckResolveError` (packages/database/src/claim-check.ts) carries a
  // `code` (ref_missing/ref_malformed/blob_not_found/checksum_mismatch) — a
  // duck-typed check avoids importing the class just to narrow the type.
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return `${(error as { code: string }).code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
