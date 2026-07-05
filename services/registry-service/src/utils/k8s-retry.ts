import type * as k8s from "@kubernetes/client-node";
import {
  getNamespacedKnativeService,
  replaceNamespacedKnativeService,
} from "../common/registry-row-mappers";
import { isK8sConflict } from "./k8s-error";

/** Bounded retry budget for the read-mutate-replace loop below. */
const DEFAULT_MAX_ATTEMPTS = 5;
/** Base delay for the exponential backoff between conflict retries (ms). */
const BASE_BACKOFF_MS = 50;
/** Upper bound for the exponential backoff (ms). */
const MAX_BACKOFF_MS = 500;

function backoffDelayMs(attempt: number): number {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * (exp / 2));
  return exp + jitter;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface IReplaceWithConflictRetryOptions {
  /** Max number of GET+PUT attempts before giving up (default 5). */
  maxAttempts?: number;
  /** Injectable delay function — tests can pass a no-op to skip real waits. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Read-mutate-replace loop for a Knative Service custom object, with bounded
 * retry on HTTP 409 (optimistic-concurrency conflict).
 *
 * Knative's own reconciler frequently updates the same Service object
 * concurrently (status, annotations), which makes a naive
 * GET -> mutate -> PUT(resourceVersion) sequence race and fail with 409.
 *
 * On conflict, this re-GETs the object (fresh `resourceVersion`) and
 * re-applies `mutate` to that FRESH object before retrying the PUT — it
 * never reuses the stale object from a previous attempt.
 */
export async function replaceKnativeServiceWithConflictRetry(
  customApi: k8s.CustomObjectsApi,
  namespace: string,
  name: string,
  mutate: (current: Record<string, unknown>) => Record<string, unknown>,
  options: IReplaceWithConflictRetryOptions = {}
): Promise<Record<string, unknown>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const current = (await getNamespacedKnativeService(
      customApi,
      namespace,
      name
    )) as Record<string, unknown>;

    const body = mutate(current);

    try {
      return (await replaceNamespacedKnativeService(
        customApi,
        namespace,
        name,
        body
      )) as unknown as Record<string, unknown>;
    } catch (e: unknown) {
      lastError = e;
      if (!isK8sConflict(e) || attempt >= maxAttempts) {
        throw e;
      }
      await sleep(backoffDelayMs(attempt));
    }
  }

  // Unreachable in practice (the loop above always returns or throws), but
  // keeps the function's return type sound for the type-checker.
  throw lastError;
}
