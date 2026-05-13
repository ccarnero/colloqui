import { describe, expect, it } from "bun:test";
import { AdapterCacheMethod } from "@yoizen/shared";
import {
  createBypassHttpResponseCacheDecision,
  resolveHttpResponseCachePolicy,
} from "../../src/activities/_shared/http-cache/cache-policy";
import { HttpResponseCacheReason } from "../../src/activities/_shared/metrics";

describe("resolveHttpResponseCachePolicy", () => {
  const baseStrategy = {
    enabled: true,
    ttlSeconds: 60,
  } as const;

  it("defaults to GET and HEAD when methods are omitted", () => {
    const getDecision = resolveHttpResponseCachePolicy({
      enabled: true,
      strategy: baseStrategy,
      tenantId: "tenant-a",
      method: "GET",
      url: "https://example.com/resource?page=1",
      headers: {},
    });
    const postDecision = resolveHttpResponseCachePolicy({
      enabled: true,
      strategy: baseStrategy,
      tenantId: "tenant-a",
      method: "POST",
      url: "https://example.com/resource?page=1",
      headers: {},
      body: '{"page":1}',
    });

    expect(getDecision.policy).not.toBeNull();
    expect(postDecision.policy).toBeNull();
    expect(postDecision.reason).toBe(HttpResponseCacheReason.METHOD);
  });

  it("hashes the body for mutating methods by default", () => {
    const shared = {
      enabled: true,
      strategy: {
        enabled: true,
        ttlSeconds: 60,
        methods: [AdapterCacheMethod.POST],
      },
      tenantId: "tenant-a",
      method: "POST",
      url: "https://example.com/search",
      headers: {},
    };

    const left = resolveHttpResponseCachePolicy({
      ...shared,
      body: '{"query":"alpha"}',
    });
    const right = resolveHttpResponseCachePolicy({
      ...shared,
      body: '{"query":"beta"}',
    });

    expect(left.policy?.key).not.toBe(right.policy?.key);
  });

  it("filters query params and headers that participate in the key", () => {
    const left = resolveHttpResponseCachePolicy({
      enabled: true,
      strategy: {
        enabled: true,
        ttlSeconds: 60,
        keyHeaders: ["x-region"],
        keyQueryParams: ["page"],
      },
      tenantId: "tenant-a",
      method: "GET",
      url: "https://example.com/items?page=1&ignored=a",
      headers: { "X-Region": "us-east-1", "X-Ignored": "a" },
    });
    const right = resolveHttpResponseCachePolicy({
      enabled: true,
      strategy: {
        enabled: true,
        ttlSeconds: 60,
        keyHeaders: ["x-region"],
        keyQueryParams: ["page"],
      },
      tenantId: "tenant-a",
      method: "GET",
      url: "https://example.com/items?page=1&ignored=b",
      headers: { "x-region": "us-east-1", "x-ignored": "b" },
    });
    const changed = resolveHttpResponseCachePolicy({
      enabled: true,
      strategy: {
        enabled: true,
        ttlSeconds: 60,
        keyHeaders: ["x-region"],
        keyQueryParams: ["page"],
      },
      tenantId: "tenant-a",
      method: "GET",
      url: "https://example.com/items?page=2&ignored=b",
      headers: { "x-region": "us-east-1", "x-ignored": "b" },
    });

    expect(left.policy?.key).toBe(right.policy?.key);
    expect(left.policy?.key).not.toBe(changed.policy?.key);
  });

  it("scopes keys by tenant", () => {
    const left = resolveHttpResponseCachePolicy({
      enabled: true,
      strategy: baseStrategy,
      tenantId: "tenant-a",
      method: "GET",
      url: "https://example.com/items",
      headers: {},
    });
    const right = resolveHttpResponseCachePolicy({
      enabled: true,
      strategy: baseStrategy,
      tenantId: "tenant-b",
      method: "GET",
      url: "https://example.com/items",
      headers: {},
    });

    expect(left.policy?.key).not.toBe(right.policy?.key);
  });

  it("returns a bypass decision when caching is disabled globally", () => {
    const decision = resolveHttpResponseCachePolicy({
      enabled: false,
      strategy: baseStrategy,
      tenantId: "tenant-a",
      method: "GET",
      url: "https://example.com/items",
      headers: {},
    });

    expect(decision.policy).toBeNull();
    expect(decision.reason).toBe(HttpResponseCacheReason.FLAG_OFF);
  });
});

describe("createBypassHttpResponseCacheDecision", () => {
  it("normalizes the method and preserves the bypass reason", () => {
    const decision = createBypassHttpResponseCacheDecision(
      "post",
      HttpResponseCacheReason.UNSUPPORTED_TARGET,
    );

    expect(decision.method).toBe("POST");
    expect(decision.policy).toBeNull();
    expect(decision.reason).toBe(HttpResponseCacheReason.UNSUPPORTED_TARGET);
  });
});
