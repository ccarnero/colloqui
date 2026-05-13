import { describe, it, expect } from "bun:test";
import { platformServiceUrl } from "@yoizen/shared";
import { httpAdapterConfig } from "../../src/config";

describe("httpAdapterConfig", () => {
  it("exposes numeric port and redis port", () => {
    expect(Number.isFinite(httpAdapterConfig.port)).toBe(true);
    expect(httpAdapterConfig.port).toBeGreaterThan(0);
    expect(Number.isFinite(httpAdapterConfig.redisPort)).toBe(true);
  });

  it("defaults connector-admin URL when CONNECTOR_ADMIN_URL unset", () => {
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    const expected =
      process.env.CONNECTOR_ADMIN_URL ??
      process.env.ADAPTER_SERVICE_URL ??
      platformServiceUrl("connector-admin-api", env);
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
