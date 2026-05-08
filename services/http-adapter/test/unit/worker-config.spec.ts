import { describe, it, expect } from "bun:test";
import { platformServiceUrl } from "@yoizen/shared";
import { httpAdapterConfig } from "../../src/config";

describe("httpAdapterConfig", () => {
  it("exposes numeric port and redis port", () => {
    expect(Number.isFinite(httpAdapterConfig.port)).toBe(true);
    expect(httpAdapterConfig.port).toBeGreaterThan(0);
    expect(Number.isFinite(httpAdapterConfig.redisPort)).toBe(true);
  });

  it("defaults adapter URL to env-aware URL when ADAPTER_SERVICE_URL unset", () => {
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    const expected =
      process.env.ADAPTER_SERVICE_URL ??
      platformServiceUrl("adapter-service-api", env);
    expect(httpAdapterConfig.adapterServiceUrl).toBe(expected);
  });

  it("defaults registry URL to env-aware URL when REGISTRY_SERVICE_URL unset", () => {
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    const expected =
      process.env.REGISTRY_SERVICE_URL ??
      platformServiceUrl("registry-service", env);
    expect(httpAdapterConfig.registryServiceUrl).toBe(expected);
  });

  it("defaults temporal address and namespace", () => {
    expect(httpAdapterConfig.temporalAddress.length).toBeGreaterThan(0);
    expect(httpAdapterConfig.temporalNamespace.length).toBeGreaterThan(
      0,
    );
  });
});
