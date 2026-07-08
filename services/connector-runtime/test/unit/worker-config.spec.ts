import { describe, expect, it } from "bun:test";
import { platformServiceUrl } from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../../src/config";

describe("workflowHttpWorkerConfig", () => {
  it("exposes numeric port and redis port", () => {
    expect(Number.isFinite(workflowHttpWorkerConfig.port)).toBe(true);
    expect(workflowHttpWorkerConfig.port).toBeGreaterThan(0);
    expect(Number.isFinite(workflowHttpWorkerConfig.redisPort)).toBe(true);
  });

  it("defaults connector-admin URL when CONNECTOR_ADMIN_URL unset", () => {
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    const expected =
      process.env.CONNECTOR_ADMIN_URL ??
      platformServiceUrl("connector-admin-api", env);
    expect(workflowHttpWorkerConfig.adapterServiceUrl).toBe(expected);
  });

  it("defaults registry URL to env-aware URL when REGISTRY_SERVICE_URL unset", () => {
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    const expected =
      process.env.REGISTRY_SERVICE_URL ??
      platformServiceUrl("registry-service", env);
    expect(workflowHttpWorkerConfig.registryServiceUrl).toBe(expected);
  });

  it("defaults temporal address and namespace", () => {
    expect(workflowHttpWorkerConfig.temporalAddress.length).toBeGreaterThan(0);
    expect(workflowHttpWorkerConfig.temporalNamespace.length).toBeGreaterThan(
      0
    );
  });
});
