import { SdkError } from "../domain/errors.js";

/** Methods that are safe to retry by default (idempotent per HTTP semantics). */
const DEFAULT_IDEMPOTENT_METHODS = new Set(["GET", "PUT", "DELETE"]);

export interface RetryConfig {
  /** Force retries on/off regardless of the method-based default. */
  enabled?: boolean;
  /** Total attempts including the first try. Default 3. */
  maxAttempts?: number;
  /** Base delay for the exponential backoff, in ms. Default 200. */
  baseDelayMs?: number;
  /** Upper bound for any single backoff delay, in ms. Default 5000. */
  maxDelayMs?: number;
}

export interface ResolveRetryPolicyArgs {
  method: string;
  /** Presence of an idempotency key allows retrying an otherwise non-idempotent POST. */
  idempotencyKey?: string;
  /** Client-level default, set once via `createClient({ retry })`. */
  clientRetry?: RetryConfig | false;
  /** Per-call override, wins over the client default. */
  callRetry?: RetryConfig | false;
}

export interface RetryPolicy {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const POLICY_DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
} as const;

/** Default retry eligibility: idempotent methods, or POST with an idempotency key. */
export function isRetryableByDefault(
  method: string,
  idempotencyKey?: string
): boolean {
  const m = method.toUpperCase();
  if (DEFAULT_IDEMPOTENT_METHODS.has(m)) {
    return true;
  }
  return m === "POST" && Boolean(idempotencyKey);
}

/**
 * Merge the method-based default with client- and call-level overrides
 * (call wins over client, client wins over the default) into a concrete
 * policy `executeWithRetry` can run.
 */
export function resolveRetryPolicy({
  method,
  idempotencyKey,
  clientRetry,
  callRetry,
}: ResolveRetryPolicyArgs): RetryPolicy {
  const clientCfg = clientRetry === false ? {} : (clientRetry ?? {});
  const callCfg = callRetry === false ? {} : (callRetry ?? {});

  const defaultEnabled = isRetryableByDefault(method, idempotencyKey);
  const clientEnabled = clientRetry === false ? false : clientCfg.enabled;
  const callEnabled = callRetry === false ? false : callCfg.enabled;

  const enabled = callEnabled ?? clientEnabled ?? defaultEnabled;

  return {
    enabled,
    maxAttempts:
      callCfg.maxAttempts ??
      clientCfg.maxAttempts ??
      POLICY_DEFAULTS.maxAttempts,
    baseDelayMs:
      callCfg.baseDelayMs ??
      clientCfg.baseDelayMs ??
      POLICY_DEFAULTS.baseDelayMs,
    maxDelayMs:
      callCfg.maxDelayMs ?? clientCfg.maxDelayMs ?? POLICY_DEFAULTS.maxDelayMs,
  };
}

/** True for NETWORK errors and 5xx responses — the only classes worth retrying. */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof SdkError)) {
    return false;
  }
  if (err.code === "NETWORK") {
    return true;
  }
  const status = (err.details as { httpStatus?: unknown } | undefined)
    ?.httpStatus;
  return typeof status === "number" && status >= 500 && status < 600;
}

/**
 * Full-jitter exponential backoff (AWS-style): a uniform random delay in
 * `[0, min(maxDelayMs, baseDelayMs * 2^attempt)]`. `attempt` is 0-based
 * (0 = delay before the 2nd try).
 */
export function computeBackoffMs(
  attempt: number,
  baseDelayMs: number = POLICY_DEFAULTS.baseDelayMs,
  maxDelayMs: number = POLICY_DEFAULTS.maxDelayMs,
  randomFn: () => number = Math.random
): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(randomFn() * cap);
}

export interface ExecuteWithRetryOptions {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * Runs `fn`, retrying on `isRetryableError` failures per `policy` with full
 * jitter backoff between attempts. Non-retryable errors and the last attempt
 * always propagate immediately.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  { sleep = defaultSleep, random = Math.random }: ExecuteWithRetryOptions = {}
): Promise<T> {
  if (!policy.enabled) {
    return fn();
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === policy.maxAttempts - 1;
      if (isLastAttempt || !isRetryableError(err)) {
        throw err;
      }
      const delayMs = computeBackoffMs(
        attempt,
        policy.baseDelayMs,
        policy.maxDelayMs,
        random
      );
      await sleep(delayMs);
    }
  }
  // Unreachable: the loop always either returns or throws.
  throw lastErr;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
