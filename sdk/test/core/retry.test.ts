import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeBackoffMs,
  executeWithRetry,
  isRetryableByDefault,
  isRetryableError,
  resolveRetryPolicy,
} from "../../src/core/retry.js";
import { SdkError } from "../../src/domain/errors.js";

test("isRetryableByDefault: GET/PUT/DELETE are retryable, POST is not (without an idempotency key)", () => {
  assert.equal(isRetryableByDefault("GET"), true);
  assert.equal(isRetryableByDefault("get"), true);
  assert.equal(isRetryableByDefault("PUT"), true);
  assert.equal(isRetryableByDefault("DELETE"), true);
  assert.equal(isRetryableByDefault("POST"), false);
  assert.equal(isRetryableByDefault("PATCH"), false);
});

test("isRetryableByDefault: POST becomes retryable with an idempotency key", () => {
  assert.equal(isRetryableByDefault("POST", "key-1"), true);
  assert.equal(isRetryableByDefault("POST", ""), false);
});

test("isRetryableError: NETWORK errors and 5xx are retryable", () => {
  assert.equal(
    isRetryableError(new SdkError("boom", { code: "NETWORK" })),
    true
  );
  assert.equal(
    isRetryableError(
      new SdkError("x", { code: "HTTP", details: { httpStatus: 503 } })
    ),
    true
  );
});

test("isRetryableError: 4xx and non-SdkError are not retryable", () => {
  assert.equal(
    isRetryableError(
      new SdkError("x", { code: "HTTP", details: { httpStatus: 404 } })
    ),
    false
  );
  assert.equal(isRetryableError(new Error("plain")), false);
});

test("resolveRetryPolicy: defaults from method, client override, call override precedence", () => {
  const getDefault = resolveRetryPolicy({ method: "GET" });
  assert.equal(getDefault.enabled, true);
  assert.equal(getDefault.maxAttempts, 3);

  const postDefault = resolveRetryPolicy({ method: "POST" });
  assert.equal(postDefault.enabled, false);

  const clientForcesOn = resolveRetryPolicy({
    method: "POST",
    clientRetry: { enabled: true, maxAttempts: 5 },
  });
  assert.equal(clientForcesOn.enabled, true);
  assert.equal(clientForcesOn.maxAttempts, 5);

  const callOverridesClient = resolveRetryPolicy({
    method: "GET",
    clientRetry: { enabled: true },
    callRetry: { enabled: false },
  });
  assert.equal(callOverridesClient.enabled, false);

  const clientDisablesGlobally = resolveRetryPolicy({
    method: "GET",
    clientRetry: false,
  });
  assert.equal(clientDisablesGlobally.enabled, false);
});

test("computeBackoffMs: full jitter stays within [0, cap] and respects maxDelayMs", () => {
  const always1 = () => 0.999999;
  assert.equal(computeBackoffMs(0, 200, 5000, always1), 199);
  assert.equal(computeBackoffMs(1, 200, 5000, always1), 399);
  // attempt 5 would be 200*32=6400, capped at maxDelayMs=5000
  assert.equal(computeBackoffMs(5, 200, 5000, always1), 4999);

  const always0 = () => 0;
  assert.equal(computeBackoffMs(3, 200, 5000, always0), 0);
});

test("executeWithRetry: retries retryable errors up to maxAttempts, then succeeds", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const result = await executeWithRetry(
    async () => {
      attempts++;
      if (attempts < 3) {
        throw new SdkError("boom", { code: "NETWORK" });
      }
      return "ok";
    },
    { enabled: true, maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 5000 },
    { sleep: async (ms) => void sleeps.push(ms), random: () => 0 }
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2);
});

test("executeWithRetry: exhausting maxAttempts rethrows the last error", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      executeWithRetry(
        async () => {
          attempts++;
          throw new SdkError("boom", { code: "NETWORK" });
        },
        { enabled: true, maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
        { sleep: async () => undefined }
      ),
    (err: unknown) => err instanceof SdkError && err.code === "NETWORK"
  );
  assert.equal(attempts, 2);
});

test("executeWithRetry: non-retryable errors propagate immediately without extra attempts", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      executeWithRetry(
        async () => {
          attempts++;
          throw new SdkError("nope", {
            code: "HTTP",
            details: { httpStatus: 404 },
          });
        },
        { enabled: true, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
        { sleep: async () => undefined }
      ),
    (err: unknown) => err instanceof SdkError && err.code === "HTTP"
  );
  assert.equal(attempts, 1);
});

test("executeWithRetry: disabled policy runs fn exactly once, error or not", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      executeWithRetry(
        async () => {
          attempts++;
          throw new SdkError("boom", { code: "NETWORK" });
        },
        { enabled: false, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }
      ),
    SdkError
  );
  assert.equal(attempts, 1);
});
