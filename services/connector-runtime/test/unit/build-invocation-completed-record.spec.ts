import { describe, expect, it } from "bun:test";
import { buildInvocationCompletedRecord } from "../../src/lib/invoke-consumer/build-invocation-completed-record";
import { err, ok } from "../../src/lib/result";

const FIXED_NOW = () => new Date("2026-07-14T00:00:00.000Z");

describe("buildInvocationCompletedRecord", () => {
  it("builds an ok record from a successful core result", () => {
    const record = buildInvocationCompletedRecord(
      "acme",
      "inv-1",
      ok({ status: 200, data: { hello: "world" }, headers: {} }),
      FIXED_NOW
    );
    expect(record).toEqual({
      status: "completed",
      tenantId: "acme",
      invocationId: "inv-1",
      completedAt: "2026-07-14T00:00:00.000Z",
      outcome: "ok",
      result: { status: 200, data: { hello: "world" }, headers: {} },
    });
  });

  it("builds an error record from a breaker_open core failure", () => {
    const record = buildInvocationCompletedRecord(
      "acme",
      "inv-1",
      err({
        kind: "breaker_open",
        key: "k",
        status: "OPEN",
        reason: "too many failures",
        cooldownMs: 5000,
      }),
      FIXED_NOW
    );
    expect(record.outcome).toBe("error");
    expect(record.error).toEqual({
      kind: "breaker_open",
      message: "circuit breaker OPEN: too many failures",
    });
    expect(record.result).toBeUndefined();
  });

  it("builds an error record from an http_error core failure", () => {
    const record = buildInvocationCompletedRecord(
      "acme",
      "inv-1",
      err({ kind: "http_error", message: "boom", cause: new Error("boom") }),
      FIXED_NOW
    );
    expect(record.error).toEqual({ kind: "http_error", message: "boom" });
  });
});
