import "../setup-env";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// Regression test for a bug found during T04 (manual-loops/
// declarative-provisioning.md): the downstream fallback hostnames MUST
// match the REAL Knative/K8s Service names declared in
// `knative/services/base/*.yaml`. channel-service, connector-admin, and
// workflow-service all ship their API server as a `-api`-suffixed Knative
// Service — there is no plain `channel-service`/`connector-admin`/
// `workflow-service` k8s Service to resolve in-cluster. Before the fix,
// `config.ts` pointed at the non-existent plain names, which would break
// every T03 `findByName` call AND every T04 apply write once deployed.

describe("provisioningServiceConfig.downstreamServiceUrls — real Knative Service names", () => {
  const envKeys = [
    "CHANNEL_SERVICE_URL",
    "CONNECTOR_ADMIN_URL",
    "AGENT_ADMIN_SERVICE_URL",
    "REGISTRY_SERVICE_URL",
    "WORKFLOW_SERVICE_URL",
    "PLATFORM_ENVIRONMENT",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("defaults to the -api-suffixed Knative Service names for channels/connectors/workflows", async () => {
    // Re-import after clearing env so getters compute fresh fallbacks.
    const { provisioningServiceConfig } = await import(
      `../../src/config?bust=${Date.now()}-${Math.random()}`
    );
    const urls = provisioningServiceConfig.downstreamServiceUrls;

    expect(urls.channels).toBe(
      "http://channel-service-api.platform-services-dev.svc.cluster.local"
    );
    expect(urls.connectors).toBe(
      "http://connector-admin-api.platform-services-dev.svc.cluster.local"
    );
    expect(urls.workflows).toBe(
      "http://workflow-service-api.platform-services-dev.svc.cluster.local"
    );
    // These two ARE the real Knative Service names already — unchanged.
    expect(urls.agents).toBe(
      "http://agent-admin-service.platform-services-dev.svc.cluster.local"
    );
    expect(urls.registry).toBe(
      "http://registry-service.platform-services-dev.svc.cluster.local"
    );
  });

  it("explicit env overrides still win over the fallback hostnames", async () => {
    process.env.CHANNEL_SERVICE_URL = "http://custom-channels.example.com";
    const { provisioningServiceConfig } = await import(
      `../../src/config?bust=${Date.now()}-${Math.random()}`
    );
    expect(provisioningServiceConfig.downstreamServiceUrls.channels).toBe(
      "http://custom-channels.example.com"
    );
  });
});
