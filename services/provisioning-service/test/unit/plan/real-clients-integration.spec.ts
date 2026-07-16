import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import type { PlatformResourceClients } from "../../../src/modules/plan/domain/platform-resource-client.interface";
import { createAgentsClient } from "../../../src/modules/plan/infrastructure/agents-client";
import { createChannelsClient } from "../../../src/modules/plan/infrastructure/channels-client";
import { createConnectorsClient } from "../../../src/modules/plan/infrastructure/connectors-client";
import { createRegistryServicesClient } from "../../../src/modules/plan/infrastructure/registry-services-client";
import { createSystemVariablesClient } from "../../../src/modules/plan/infrastructure/system-variables-client";
import { createWorkflowsClient } from "../../../src/modules/plan/infrastructure/workflows-client";
import { buildManifestPlan } from "../../../src/modules/plan/lib/build-manifest-plan";

// End-to-end at the client boundary: wire the REAL production client factories
// (createChannelsClient/createConnectorsClient/... — no hand-seeded fields)
// through `buildManifestPlan`, mocking only the HTTP layer with realistic
// downstream response shapes. Proves two things the hand-seeded unit tests
// cannot:
//   1. A realistic manifest whose live state matches converges to an ALL-NOOP
//      plan (idempotency through the actual projections).
//   2. Secret VALUES present in live responses never appear anywhere in the
//      serialized plan.

const LIVE_ENV_SECRET_VALUE = "live-env-secret-DO-NOT-LEAK";
const LIVE_AUTH_SECRET_VALUE = "live-authconfig-apiKey-DO-NOT-LEAK";

const BASE = {
  channels: "http://channel-service.local",
  connectors: "http://connector-admin.local",
  agents: "http://agent-admin-service.local",
  registry: "http://registry-service.local",
  workflows: "http://workflow-service.local",
};

function realClients(): PlatformResourceClients {
  return {
    channel: createChannelsClient(BASE.channels),
    connector: createConnectorsClient(BASE.connectors),
    agent: createAgentsClient(BASE.agents),
    service: createRegistryServicesClient(BASE.registry),
    systemVariable: createSystemVariablesClient(BASE.agents),
    workflow: createWorkflowsClient(BASE.workflows),
  };
}

function realisticManifest(): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "crm-support" },
    spec: {
      channels: [
        {
          name: "support-telegram",
          type: "telegram",
          direction: "inbound",
          secretRef: "tg-bot-token",
        },
      ],
      connectors: [
        {
          name: "hubspot",
          type: "http",
          auth: {
            authType: "bearer",
            bearerToken: { secretRef: "hubspot-api-key" },
          },
        },
      ],
      agents: [{ name: "support-agent", profile: { model: "gpt-4" } }],
      knowledgeBases: [],
      services: [
        {
          name: "priority-scorer",
          image: "registry.example.com/priority-scorer:1.0",
          env: [{ name: "API_KEY", secretRef: "scorer-api-key" }],
        },
      ],
      systemVariables: [],
      workflows: [
        {
          name: "ticket-router",
          definition: {
            steps: [
              { type: "channelSend", channelRef: "support-telegram" },
              { type: "agentCall", agentRef: "support-agent" },
              { type: "serviceCall", serviceRef: "priority-scorer" },
            ],
          },
        },
      ],
      // external → provisioned out-of-band, not reported as missing_secret
      secrets: [
        {
          name: "tg-bot-token",
          scope: { kind: "channel", owner: "support-telegram" },
          external: true,
        },
        {
          name: "hubspot-api-key",
          scope: { kind: "connector", owner: "hubspot" },
          external: true,
        },
        {
          name: "scorer-api-key",
          scope: { kind: "service", owner: "priority-scorer" },
          external: true,
        },
      ],
    },
  };
}

/** Live downstream state that MATCHES the manifest exactly (→ all-noop). */
function installMatchingDownstream(): void {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.startsWith(BASE.channels)) {
      return json([
        { id: "chan-1", name: "support-telegram", channel: "telegram" },
      ]);
    }
    if (url.startsWith(BASE.connectors)) {
      return json([
        {
          id: "conn-1",
          name: "hubspot",
          context: "external",
          baseUrl: "https://hubspot.example.com",
          authType: "apiKey",
          authConfig: { apiKey: LIVE_AUTH_SECRET_VALUE },
        },
      ]);
    }
    if (url.startsWith(BASE.agents)) {
      return json({
        agents: [{ id: "agent-uuid-1", name: "support-agent" }],
        total: 1,
      });
    }
    if (url.startsWith(BASE.registry)) {
      return json([
        {
          id: "svc-1",
          name: "priority-scorer",
          image: "registry.example.com/priority-scorer:1.0",
          envVars: { API_KEY: LIVE_ENV_SECRET_VALUE },
        },
      ]);
    }
    if (url.startsWith(BASE.workflows)) {
      return json([{ id: "wf-1", name: "ticket-router" }]);
    }
    throw new Error(`unexpected URL in test: ${url}`);
  }) as unknown as typeof fetch;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("real client factories through buildManifestPlan", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("a realistic manifest whose live state matches converges to an ALL-NOOP plan", async () => {
    installMatchingDownstream();

    const result = await buildManifestPlan(
      realisticManifest(),
      "tenant-a",
      realClients()
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resources).toHaveLength(5);
      for (const entry of result.value.resources) {
        expect(entry.verdict).toBe("noop");
      }
      // external secrets → no missing_secret preconditions
      expect(
        result.value.preconditions.some((p) => p.kind === "missing_secret")
      ).toBe(false);
    }
  });

  it("secret VALUES from live responses never appear anywhere in the serialized plan", async () => {
    installMatchingDownstream();

    const result = await buildManifestPlan(
      realisticManifest(),
      "tenant-a",
      realClients()
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value);
      expect(serialized).not.toContain(LIVE_ENV_SECRET_VALUE);
      expect(serialized).not.toContain(LIVE_AUTH_SECRET_VALUE);
    }
  });

  it("re-planning the same manifest against the same live state is stable (still all-noop)", async () => {
    installMatchingDownstream();
    const clients = realClients();
    const manifest = realisticManifest();

    const first = await buildManifestPlan(manifest, "tenant-a", clients);
    const second = await buildManifestPlan(manifest, "tenant-a", clients);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.resources.every((r) => r.verdict === "noop")).toBe(
        true
      );
      expect(second.value.resources.every((r) => r.verdict === "noop")).toBe(
        true
      );
    }
  });
});
