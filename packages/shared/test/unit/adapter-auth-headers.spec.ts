import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  AdapterCacheMethod,
  type AdapterConfig,
} from "../../src/adapter.interfaces";
import { applyAdapterAuthHeadersSync } from "../../src/adapter-auth-headers";

function makeAdapter(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    id: "adp-1",
    tenantId: "t1",
    name: "Test Adapter",
    context: "test",
    baseUrl: "https://api.example.com",
    authType: "none",
    authConfig: {},
    headers: [],
    timeoutMs: 5000,
    maxRetries: 2,
    retryBackoffMs: 200,
    healthCheckPath: "/health",
    status: "enabled",
    tags: [],
    defaultCache: {
      enabled: true,
      ttlSeconds: 60,
      methods: [AdapterCacheMethod.GET],
    },
    endpoints: [],
    ...overrides,
  };
}

describe("applyAdapterAuthHeadersSync", () => {
  const originalWarn = console.warn;

  afterEach(() => {
    console.warn = originalWarn;
  });

  it("should inject nothing for authType none", () => {
    const headers: Record<string, string> = {};
    applyAdapterAuthHeadersSync(makeAdapter({ authType: "none" }), headers);
    expect(headers).toEqual({});
  });

  it("should inject the api-key header using the configured header name", () => {
    const headers: Record<string, string> = {};
    applyAdapterAuthHeadersSync(
      makeAdapter({
        authType: "api-key",
        authConfig: { apiKey: "secret-123", apiKeyHeader: "X-My-Key" },
      }),
      headers
    );
    expect(headers["X-My-Key"]).toBe("secret-123");
  });

  it("should default the api-key header name to X-API-Key", () => {
    const headers: Record<string, string> = {};
    applyAdapterAuthHeadersSync(
      makeAdapter({
        authType: "api-key",
        authConfig: { apiKey: "secret-123" },
      }),
      headers
    );
    expect(headers["X-API-Key"]).toBe("secret-123");
  });

  it("should inject the bearer Authorization header", () => {
    const headers: Record<string, string> = {};
    applyAdapterAuthHeadersSync(
      makeAdapter({
        authType: "bearer",
        authConfig: { bearerToken: "tok-abc" },
      }),
      headers
    );
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
  });

  it("should inject the basic Authorization header", () => {
    const headers: Record<string, string> = {};
    applyAdapterAuthHeadersSync(
      makeAdapter({
        authType: "basic",
        authConfig: { basicUsername: "user", basicPassword: "pass" },
      }),
      headers
    );
    expect(headers["Authorization"]).toBe(`Basic ${btoa("user:pass")}`);
  });

  // Regression guard: connectors persisted with an auth type the platform no
  // longer supports (e.g. the removed `oauth2-client`) must NOT silently send
  // an unauthenticated request — no header is injected AND the drop is logged.
  it("should inject no auth header and warn for an unrecognized authType", () => {
    const warnings: string[] = [];
    console.warn = mock((message: string) => {
      warnings.push(message);
    }) as unknown as typeof console.warn;

    const headers: Record<string, string> = {};
    applyAdapterAuthHeadersSync(
      makeAdapter({
        authType: "oauth2-client",
        authConfig: { access_token: "should-not-be-used" },
      }),
      headers
    );

    expect(headers).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("unsupported authType 'oauth2-client'");
    expect(warnings[0]).toContain("adp-1");
  });

  it("should leave pre-existing headers untouched for an unrecognized authType", () => {
    console.warn = mock(() => undefined) as unknown as typeof console.warn;

    const headers: Record<string, string> = { "X-Custom": "yes" };
    applyAdapterAuthHeadersSync(
      makeAdapter({ authType: "totally-unknown" }),
      headers
    );

    expect(headers).toEqual({ "X-Custom": "yes" });
  });
});
