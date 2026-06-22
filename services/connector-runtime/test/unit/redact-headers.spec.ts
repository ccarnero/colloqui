import { describe, expect, it } from "bun:test";
import { redactHeaders } from "../../src/activities/_shared/redact-headers";

describe("redactHeaders", () => {
  it("redacts authorization header", () => {
    const result = redactHeaders({ Authorization: "Bearer tok123" });
    expect(result).toEqual({ Authorization: "[REDACTED]" });
  });

  it("redacts x-api-key header (case-insensitive)", () => {
    const result = redactHeaders({ "x-api-key": "abc123" });
    expect(result).toEqual({ "x-api-key": "[REDACTED]" });
  });

  it("redacts x-api-secret header", () => {
    const result = redactHeaders({ "x-api-secret": "secret_value" });
    expect(result).toEqual({ "x-api-secret": "[REDACTED]" });
  });

  it("redacts cookie header", () => {
    const result = redactHeaders({ cookie: "session=xyz" });
    expect(result).toEqual({ cookie: "[REDACTED]" });
  });

  it("redacts set-cookie header", () => {
    const result = redactHeaders({ "set-cookie": "id=123" });
    expect(result).toEqual({ "set-cookie": "[REDACTED]" });
  });

  it("redacts header containing 'token'", () => {
    const result = redactHeaders({ "X-Custom-Token": "tok_abc" });
    expect(result).toEqual({ "X-Custom-Token": "[REDACTED]" });
  });

  it("redacts header containing 'secret'", () => {
    const result = redactHeaders({ "x-secret-key": "secret123" });
    expect(result).toEqual({ "x-secret-key": "[REDACTED]" });
  });

  it("redacts header containing 'auth'", () => {
    const result = redactHeaders({ "custom-auth": "value" });
    expect(result).toEqual({ "custom-auth": "[REDACTED]" });
  });

  it("does not redact content-type header", () => {
    const result = redactHeaders({ "content-type": "application/json" });
    expect(result).toEqual({ "content-type": "application/json" });
  });

  it("does not redact standard headers", () => {
    const result = redactHeaders({
      "x-correlation-id": "corr-123",
      "user-agent": "client/1.0",
      accept: "application/json",
    });
    expect(result).toEqual({
      "x-correlation-id": "corr-123",
      "user-agent": "client/1.0",
      accept: "application/json",
    });
  });

  it("handles mixed sensitive and non-sensitive headers", () => {
    const result = redactHeaders({
      Authorization: "Bearer xyz",
      "content-type": "application/json",
      "x-api-key": "key123",
      "x-correlation-id": "corr-abc",
      cookie: "session=123",
    });
    expect(result).toEqual({
      Authorization: "[REDACTED]",
      "content-type": "application/json",
      "x-api-key": "[REDACTED]",
      "x-correlation-id": "corr-abc",
      cookie: "[REDACTED]",
    });
  });

  it("returns empty object for empty input", () => {
    const result = redactHeaders({});
    expect(result).toEqual({});
  });

  it("preserves original header name casing", () => {
    const result = redactHeaders({
      Authorization: "token",
      "Content-Type": "json",
    });
    expect(result).toEqual({
      Authorization: "[REDACTED]",
      "Content-Type": "json",
    });
    expect(Object.keys(result)).toContain("Authorization");
    expect(Object.keys(result)).toContain("Content-Type");
  });
});
