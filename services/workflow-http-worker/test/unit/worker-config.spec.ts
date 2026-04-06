import { describe, it, expect } from "bun:test";
import { DEFAULT_ADAPTER_SERVICE_URL } from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../../src/config";

describe("workflowHttpWorkerConfig", () => {
  it("exposes numeric port and redis port", () => {
    expect(Number.isFinite(workflowHttpWorkerConfig.port)).toBe(true);
    expect(workflowHttpWorkerConfig.port).toBeGreaterThan(0);
    expect(Number.isFinite(workflowHttpWorkerConfig.redisPort)).toBe(true);
  });

  it("defaults adapter URL to shared constant when ADAPTER_SERVICE_URL unset", () => {
    const expected =
      process.env.ADAPTER_SERVICE_URL ?? DEFAULT_ADAPTER_SERVICE_URL;
    expect(workflowHttpWorkerConfig.adapterServiceUrl).toBe(expected);
  });

  it("defaults temporal address and namespace", () => {
    expect(workflowHttpWorkerConfig.temporalAddress.length).toBeGreaterThan(0);
    expect(workflowHttpWorkerConfig.temporalNamespace.length).toBeGreaterThan(
      0,
    );
  });
});
