import { agentAiServiceConfig } from "../config";
import type { ChatRequest } from "../modules/chat/chat.dto";

/**
 * Deterministic execution delay hook (long-running-agent-executions.md T02).
 *
 * Purpose: give the e2e/dev tooling a way to make a REAL agent execution take
 * a known amount of wall-clock time, so long-running-execution behavior
 * (polling, keepalive, timeouts) can be exercised on the real pipeline instead
 * of a mock. It is NOT a product feature:
 *
 *  - Gated by `AGENT_TEST_DELAY_ENABLED` (default OFF, code-side). Only the
 *    local dev overlays turn it on; with the gate off the key below is ignored
 *    and merely logged at debug.
 *  - Requires an EXPLICIT per-execution key ({@link TEST_DELAY_KEY}). No agent
 *    is ever delayed implicitly — in particular the fixed `e2e-http-agent-echo`
 *    agent used by the existing G2b e2e stays untouched unless the caller
 *    itself sends the key.
 *  - Hard-capped at {@link AGENT_TEST_DELAY_HARD_CAP_MS} (see config.ts) so the
 *    delay can never approach the consumer ackWait or the buffered-execution
 *    abort ceiling (both 900_000 ms).
 *  - Abort-aware: the wait rejects as soon as the execution's AbortSignal
 *    fires, so the cancel subscription and the wall-clock abort timer in
 *    `handleBuffered` keep working exactly as before.
 */

/**
 * Key the caller puts in the execution's variables (canonical:
 * `input.variables.request.__test_delay_ms`, the free-form `request` scope of
 * `VariableResolutionContext`, which `execution-client.ts` forwards verbatim
 * inside `execution_requested`) or, as a fallback, in `input.metadata`.
 */
export const TEST_DELAY_KEY = "__test_delay_ms";

/** Minimal logger surface — matches PinoLoggerService, keeps this unit-testable. */
export type TestDelayLogger = {
  debug(message: string): void;
  log(message: string): void;
  warn(message: string): void;
};

function readRawDelay(request: ChatRequest): {
  raw: unknown;
  source: string | undefined;
} {
  const fromVariables = (
    request.variables?.request as Record<string, unknown> | undefined
  )?.[TEST_DELAY_KEY];
  if (fromVariables !== undefined) {
    return {
      raw: fromVariables,
      source: `variables.request.${TEST_DELAY_KEY}`,
    };
  }
  const fromMetadata = request.metadata?.[TEST_DELAY_KEY];
  if (fromMetadata !== undefined) {
    return { raw: fromMetadata, source: `metadata.${TEST_DELAY_KEY}` };
  }
  return { raw: undefined, source: undefined };
}

/**
 * Resolves the effective delay (ms) for one execution. Returns 0 whenever the
 * hook must not fire — gate off, key absent, or key unusable. Every branch
 * logs; nothing is silent.
 */
export function resolveTestDelayMs(
  request: ChatRequest,
  context: { readonly executionId?: string; readonly tenantId: string },
  logger: TestDelayLogger
): number {
  const { raw, source } = readRawDelay(request);
  const who = `execution='${context.executionId ?? "n/a"}' tenant='${context.tenantId}'`;

  if (raw === undefined) {
    return 0;
  }

  if (!agentAiServiceConfig.testDelayEnabled) {
    logger.debug(
      `[test-delay] Gate AGENT_TEST_DELAY_ENABLED is off — ignoring ${source} for ${who}`
    );
    return 0;
  }

  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      `[test-delay] Ignoring non-positive/non-numeric ${source}='${String(raw)}' for ${who}`
    );
    return 0;
  }

  const cap = agentAiServiceConfig.testDelayMaxMs;
  if (parsed > cap) {
    logger.warn(
      `[test-delay] Requested ${source}=${parsed}ms exceeds cap ${cap}ms — clamping for ${who}`
    );
    return cap;
  }

  logger.log(
    `[test-delay] Accepted ${source}=${parsed}ms (cap=${cap}ms) for ${who}`
  );
  return parsed;
}

/**
 * Waits `ms`, rejecting immediately if `signal` aborts (cancel control message
 * or the buffered-execution wall-clock ceiling). Rejecting — rather than
 * resolving early — keeps the existing `execution_failed` /
 * `reason: "cancelled"` path in `handleBuffered` intact.
 */
export function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Execution aborted before test delay started"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("Execution aborted during test delay"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Waits an already-resolved (and already-capped) delay, logging start/end/
 * interruption with executionId + tenant.
 *
 * NOTE for callers: resolve FIRST (`resolveTestDelayMs`) and call this only
 * when the result is > 0. Awaiting an inert async no-op would insert an extra
 * microtask hop into the default (gate-off) path — behavior must stay
 * byte-identical when the hook is off.
 */
export async function waitTestDelay(
  delayMs: number,
  context: { readonly executionId?: string; readonly tenantId: string },
  signal: AbortSignal,
  logger: TestDelayLogger
): Promise<void> {
  const who = `execution='${context.executionId ?? "n/a"}' tenant='${context.tenantId}'`;
  const startedAt = Date.now();
  logger.log(`[test-delay] Start ${delayMs}ms for ${who}`);
  try {
    await delayWithAbort(delayMs, signal);
    logger.log(`[test-delay] End after ${Date.now() - startedAt}ms for ${who}`);
  } catch (error) {
    logger.warn(
      `[test-delay] Interrupted after ${Date.now() - startedAt}ms for ${who}: ${error}`
    );
    throw error;
  }
}
