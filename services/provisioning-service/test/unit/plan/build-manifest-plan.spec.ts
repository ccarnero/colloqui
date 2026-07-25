import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { HostedService, IntegrationManifest } from "@yoizen/shared";
import type {
  ManifestPlan,
  ResourceKind,
} from "../../../src/modules/plan/domain/plan.interfaces";
import type {
  DownstreamError,
  IPlatformResourceClient,
  LivePlatformResource,
  PlatformResourceClients,
} from "../../../src/modules/plan/domain/platform-resource-client.interface";
import { buildManifestPlan } from "../../../src/modules/plan/lib/build-manifest-plan";
import {
  channelComparable,
  connectorComparable,
  type RegisteredServiceDto,
  systemVariableComparable,
  workflowComparable,
} from "../../../src/modules/plan/lib/comparable-fields";

/** Convenience: find one resource plan entry by name. */
function entryFor(plan: ManifestPlan, name: string) {
  return plan.resources.find((r) => r.name === name);
}

/** In-memory fake client: `byName` seeds "live platform state". */
function fakeClient(
  kind: ResourceKind,
  byName: Record<string, LivePlatformResource> = {},
  options: { failFor?: string; failMessage?: string } = {}
): IPlatformResourceClient {
  return {
    async findByName(_tenantId, name) {
      if (options.failFor === name) {
        const error: DownstreamError = {
          kind: "downstream_error",
          resourceKind: kind,
          resourceName: name,
          message: options.failMessage ?? "simulated downstream failure",
        };
        return { ok: false, error };
      }
      return { ok: true, value: byName[name] ?? null };
    },
  };
}

function manifestWith(
  overrides: Partial<IntegrationManifest["spec"]>
): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "test-manifest" },
    spec: {
      channels: [],
      connectors: [],
      agents: [],
      knowledgeBases: [],
      services: [],
      systemVariables: [],
      mcpServers: [],
      skills: [],
      workflows: [],
      secrets: [],
      ...overrides,
    },
  };
}

function noopClients(): PlatformResourceClients {
  return {
    channel: fakeClient("channel"),
    connector: fakeClient("connector"),
    agent: fakeClient("agent"),
    service: fakeClient("service"),
    systemVariable: fakeClient("systemVariable"),
    workflow: fakeClient("workflow"),
  };
}

describe("buildManifestPlan", () => {
  it("verdict 'create' when the live platform has no matching resource", async () => {
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: {} }],
    });

    const result = await buildManifestPlan(manifest, "tenant-a", noopClients());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const channelEntry = entryFor(result.value, "http-in");
      expect(channelEntry?.verdict).toBe("create");
      expect(channelEntry?.diff).toEqual([]);
    }
  });

  it("verdict 'noop' when the live resource matches the manifest (live projected via the real contract)", async () => {
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: {} }],
    });

    const clients = noopClients();
    clients.channel = fakeClient("channel", {
      "http-in": {
        externalId: "chan-1",
        // built with the SAME `fromLive` extractor the real client uses
        fields: channelComparable.fromLive({
          id: "chan-1",
          name: "http-in",
          channel: "http",
        }),
      },
    });

    const result = await buildManifestPlan(manifest, "tenant-a", clients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const channelEntry = entryFor(result.value, "http-in");
      expect(channelEntry?.verdict).toBe("noop");
      expect(channelEntry?.externalId).toBe("chan-1");
    }
  });

  it("applying the SAME manifest against the SAME live state twice yields an all-noop plan (idempotency)", async () => {
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: { model: "gpt-4" } }],
    });

    const clients = noopClients();
    clients.channel = fakeClient("channel", {
      "http-in": {
        externalId: "chan-1",
        fields: channelComparable.fromLive({
          id: "chan-1",
          name: "http-in",
          channel: "http",
        }),
      },
    });
    // agent is existence-only: any present live agent → noop
    clients.agent = fakeClient("agent", {
      "agent-1": { externalId: "agent-uuid-1", fields: {} },
    });

    const first = await buildManifestPlan(manifest, "tenant-a", clients);
    const second = await buildManifestPlan(manifest, "tenant-a", clients);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.resources.every((r) => r.verdict === "noop")).toBe(
        true
      );
      expect(second.value.resources.every((r) => r.verdict === "noop")).toBe(
        true
      );
    }
  });

  it("verdict 'update' with field-level diff when a manifest field changed", async () => {
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: {} }],
    });

    const clients = noopClients();
    clients.channel = fakeClient("channel", {
      "http-in": {
        externalId: "chan-1",
        fields: channelComparable.fromLive({
          id: "chan-1",
          name: "http-in",
          channel: "https", // differs from manifest type "http"
        }),
      },
    });

    const result = await buildManifestPlan(manifest, "tenant-a", clients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const channelEntry = entryFor(result.value, "http-in");
      expect(channelEntry?.verdict).toBe("update");
      expect(channelEntry?.diff).toEqual([
        { field: "type", current: "https", desired: "http" },
      ]);
    }
  });

  it("reports every referenced non-external secret as a missing_secret precondition", async () => {
    const manifest = manifestWith({
      channels: [
        {
          name: "http-in",
          type: "http",
          direction: "inbound",
          secretRef: "webhook-secret",
        },
      ],
      agents: [{ name: "agent-1", profile: {} }],
      secrets: [
        {
          name: "webhook-secret",
          scope: { kind: "channel", owner: "http-in" },
        },
      ],
    });

    const result = await buildManifestPlan(manifest, "tenant-a", noopClients());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const precondition = result.value.preconditions.find(
        (p) => p.kind === "missing_secret"
      );
      expect(precondition).toBeDefined();
      expect(precondition?.refValue).toBe("webhook-secret");
      expect(precondition?.resourceKind).toBe("channel");
      expect(precondition?.resourceName).toBe("http-in");
    }
  });

  it("T05: does NOT report missing_secret when the injected checker confirms the k8s Secret key exists", async () => {
    const manifest = manifestWith({
      channels: [
        {
          name: "http-in",
          type: "http",
          direction: "inbound",
          secretRef: "webhook-secret",
        },
      ],
      agents: [{ name: "agent-1", profile: {} }],
      secrets: [
        {
          name: "webhook-secret",
          scope: { kind: "channel", owner: "http-in" },
        },
      ],
    });

    const result = await buildManifestPlan(
      manifest,
      "tenant-a",
      noopClients(),
      undefined,
      {
        async exists() {
          return { ok: true, value: true };
        },
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value.preconditions.some((p) => p.kind === "missing_secret")
      ).toBe(false);
    }
  });

  it("T05: reports missing_secret when the injected checker reports the key absent", async () => {
    const manifest = manifestWith({
      channels: [
        {
          name: "http-in",
          type: "http",
          direction: "inbound",
          secretRef: "webhook-secret",
        },
      ],
      agents: [{ name: "agent-1", profile: {} }],
      secrets: [
        {
          name: "webhook-secret",
          scope: { kind: "channel", owner: "http-in" },
        },
      ],
    });

    const result = await buildManifestPlan(
      manifest,
      "tenant-a",
      noopClients(),
      undefined,
      {
        async exists() {
          return { ok: true, value: false };
        },
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value.preconditions.some((p) => p.kind === "missing_secret")
      ).toBe(true);
    }
  });

  it("does NOT report an external secret as a missing_secret precondition", async () => {
    const manifest = manifestWith({
      channels: [
        {
          name: "http-in",
          type: "http",
          direction: "inbound",
          secretRef: "out-of-band-secret",
        },
      ],
      agents: [{ name: "agent-1", profile: {} }],
      secrets: [
        {
          name: "out-of-band-secret",
          scope: { kind: "channel", owner: "http-in" },
          external: true,
        },
      ],
    });

    const result = await buildManifestPlan(manifest, "tenant-a", noopClients());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value.preconditions.some((p) => p.kind === "missing_secret")
      ).toBe(false);
    }
  });

  it("reports 'unresolvable_external_ref' when an external resource is not found live", async () => {
    const manifest = manifestWith({
      channels: [
        {
          name: "existing-channel",
          type: "http",
          direction: "inbound",
          external: true,
        },
      ],
      agents: [{ name: "agent-1", profile: {} }],
    });

    const result = await buildManifestPlan(manifest, "tenant-a", noopClients());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value.resources.some((r) => r.name === "existing-channel")
      ).toBe(false);
      const precondition = result.value.preconditions.find(
        (p) => p.kind === "unresolvable_external_ref"
      );
      expect(precondition?.resourceName).toBe("existing-channel");
    }
  });

  it("resolves an external resource to a noop entry when it IS found live", async () => {
    const manifest = manifestWith({
      channels: [
        {
          name: "existing-channel",
          type: "http",
          direction: "inbound",
          external: true,
        },
      ],
      agents: [{ name: "agent-1", profile: {} }],
    });

    const clients = noopClients();
    clients.channel = fakeClient("channel", {
      "existing-channel": { externalId: "chan-existing", fields: {} },
    });

    const result = await buildManifestPlan(manifest, "tenant-a", clients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = entryFor(result.value, "existing-channel");
      expect(entry?.external).toBe(true);
      expect(entry?.verdict).toBe("noop");
      expect(entry?.externalId).toBe("chan-existing");
    }
  });

  it("surfaces a downstream API failure as a typed precondition, never throws", async () => {
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: {} }],
    });

    const clients = noopClients();
    clients.channel = fakeClient(
      "channel",
      {},
      { failFor: "http-in", failMessage: "connection refused" }
    );

    const result = await buildManifestPlan(manifest, "tenant-a", clients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resources.some((r) => r.name === "http-in")).toBe(
        false
      );
      const precondition = result.value.preconditions.find(
        (p) => p.kind === "downstream_error" && p.resourceName === "http-in"
      );
      expect(precondition?.message).toBe("connection refused");
    }
  });

  it("never mutates: the fake clients only ever receive findByName reads", async () => {
    const client = fakeClient("channel");
    expect(Object.keys(client)).toEqual(["findByName"]);
  });

  it("resolves the plan even for a manifest with a dependency cycle as a typed error result", async () => {
    const manifest = manifestWith({
      channels: [{ name: "chan", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: { serviceRef: "svc-1" } }],
      services: [{ name: "svc-1", image: "img:1" }],
    });
    (manifest.spec.services[0] as unknown as { agentRef: string }).agentRef =
      "agent-1";

    const result = await buildManifestPlan(manifest, "tenant-a", noopClients());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("cycle_detected");
    }
  });

  // ---------------------------------------------------------------------
  // Diff correctness PER RESOURCE KIND. Live `fields` are built with the same
  // `fromLive` extractor the production client uses (never hand-copied from
  // the desired side), so noop cases prove the two projections actually agree.
  // ---------------------------------------------------------------------

  describe("diff correctness per resource kind — connector (existence-only)", () => {
    const connector = {
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
    };
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: {} }],
      connectors: [connector],
    });

    it("create when absent live", async () => {
      const result = await buildManifestPlan(manifest, "t", noopClients());
      expect(result.ok && entryFor(result.value, "hubspot")?.verdict).toBe(
        "create"
      );
    });

    it("noop when a same-named connector exists live", async () => {
      const clients = noopClients();
      clients.connector = fakeClient("connector", {
        hubspot: {
          externalId: "conn-1",
          fields: connectorComparable.fromLive({
            id: "conn-1",
            name: "hubspot",
            context: "external",
          }),
        },
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      expect(result.ok && entryFor(result.value, "hubspot")?.verdict).toBe(
        "noop"
      );
    });
  });

  // T02 (manual-loops/provisioning-manifest-gaps.md, gap 2): `endpoints`
  // makes `connectorComparable` reachable beyond existence-only.
  describe("diff correctness per resource kind — connector endpoints (T02)", () => {
    it("update verdict when a declared endpoint is absent live (endpoint-only change)", async () => {
      const manifest = manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-1", profile: {} }],
        connectors: [
          {
            name: "hubspot",
            type: "http",
            config: { baseUrl: "https://hubspot.example.com" },
            endpoints: [
              { label: "list-contacts", method: "GET", path: "/contacts" },
            ],
          },
        ],
      });
      const clients = noopClients();
      clients.connector = fakeClient("connector", {
        hubspot: {
          externalId: "conn-1",
          fields: connectorComparable.fromLive({
            id: "conn-1",
            name: "hubspot",
            context: "external",
            endpoints: [],
          }),
        },
      });

      const result = await buildManifestPlan(manifest, "t", clients);
      expect(result.ok && entryFor(result.value, "hubspot")?.verdict).toBe(
        "update"
      );
    });

    it("noop when declared and live endpoints match, regardless of declaration order", async () => {
      const manifest = manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-1", profile: {} }],
        connectors: [
          {
            name: "hubspot",
            type: "http",
            config: { baseUrl: "https://hubspot.example.com" },
            endpoints: [
              { label: "create-contact", method: "POST", path: "/contacts" },
              { label: "list-contacts", method: "GET", path: "/contacts" },
            ],
          },
        ],
      });
      const clients = noopClients();
      clients.connector = fakeClient("connector", {
        hubspot: {
          externalId: "conn-1",
          fields: connectorComparable.fromLive({
            id: "conn-1",
            name: "hubspot",
            context: "external",
            // Live returns them in a DIFFERENT order than declared — must
            // still be noop (order-insensitive comparison).
            endpoints: [
              { label: "list-contacts", method: "get", path: "/contacts" },
              { label: "create-contact", method: "post", path: "/contacts" },
            ],
          }),
        },
      });

      const result = await buildManifestPlan(manifest, "t", clients);
      expect(result.ok && entryFor(result.value, "hubspot")?.verdict).toBe(
        "noop"
      );
    });
  });

  describe("diff correctness per resource kind — service", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "API_KEY", value: { secretRef: "scorer-api-key" } }],
    };
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: {} }],
      services: [service],
      secrets: [
        {
          name: "scorer-api-key",
          scope: { kind: "service", owner: "priority-scorer" },
          external: true,
        },
      ],
    });

    /**
     * `build-manifest-plan.ts`'s service branch reads the RAW
     * `RegisteredServiceDto` off `LivePlatformResource.raw` (never `.fields`
     * — that stays whatever `serviceComparable` computes, unused by the
     * service branch). These fixtures mirror exactly what
     * `registry-services-client.ts` puts there.
     */
    function serviceLive(
      externalId: string,
      envVars: RegisteredServiceDto["envVars"]
    ): LivePlatformResource {
      return {
        externalId,
        fields: {},
        raw: {
          id: externalId,
          name: "priority-scorer",
          image: "registry.example.com/priority-scorer:1.0",
          envVars,
        },
      };
    }

    it("create when absent live", async () => {
      const result = await buildManifestPlan(manifest, "t", noopClients());
      expect(
        result.ok && entryFor(result.value, "priority-scorer")?.verdict
      ).toBe("create");
    });

    it("noop when the service declares NO env vars at all (empty env still converges)", async () => {
      const noEnvService: HostedService = {
        name: "priority-scorer",
        image: "registry.example.com/priority-scorer:1.0",
      };
      const noEnvManifest = manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-1", profile: {} }],
        services: [noEnvService],
      });
      const clients = noopClients();
      clients.service = fakeClient("service", {
        "priority-scorer": serviceLive("svc-1", {}),
      });
      const result = await buildManifestPlan(noEnvManifest, "t", clients);
      expect(
        result.ok && entryFor(result.value, "priority-scorer")?.verdict
      ).toBe("noop");
    });

    it("noop when the live secretKeyRef identity matches the manifest's secretRef binding", async () => {
      const clients = noopClients();
      clients.service = fakeClient("service", {
        "priority-scorer": serviceLive("svc-1", {
          API_KEY: {
            secretKeyRef: {
              name: "psec-service-priority-scorer",
              key: "scorer-api-key",
            },
          },
        }),
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      expect(
        result.ok && entryFor(result.value, "priority-scorer")?.verdict
      ).toBe("noop");
    });

    it("update when the set of env var names changed", async () => {
      const clients = noopClients();
      clients.service = fakeClient("service", {
        "priority-scorer": serviceLive("svc-1", { OTHER_VAR: "x" }),
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      if (result.ok) {
        const entry = entryFor(result.value, "priority-scorer");
        expect(entry?.verdict).toBe("update");
        expect(entry?.diff.map((d) => d.field)).toEqual(["env"]);
      }
    });

    // manual-loops/demos/crm-support-telegram.md T04 findings ("STALE-STATE
    // MASKING") — THE INCIDENT: a live registered service whose env var has
    // the SAME NAME but a DIFFERENT MECHANISM (plaintext literal instead of
    // the manifest's `secretRef` -> `valueFrom.secretKeyRef`) must now
    // produce `update`, not the masked `noop` envNames-only comparison gave
    // it. No live secret value may appear anywhere in the serialized plan.
    it("update when the live mechanism is a plaintext literal but the manifest declares secretRef (mechanism drift) — never leaks the live value", async () => {
      const PLAINTEXT_CREDENTIAL = "sk-live-yoizen-credential-DO-NOT-LEAK";
      const clients = noopClients();
      clients.service = fakeClient("service", {
        "priority-scorer": serviceLive("svc-1", {
          API_KEY: PLAINTEXT_CREDENTIAL,
        }),
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = entryFor(result.value, "priority-scorer");
        expect(entry?.verdict).toBe("update");
        expect(entry?.diff.map((d) => d.field)).toEqual(["env"]);
        expect(JSON.stringify(result.value)).not.toContain(
          PLAINTEXT_CREDENTIAL
        );
      }
    });

    it("noop when a { connectorRef } env value resolves to the SAME plain id the live side reports (plan-time resolvedIds reuse)", async () => {
      const serviceWithConnectorRef: HostedService = {
        name: "priority-scorer",
        image: "registry.example.com/priority-scorer:1.0",
        env: [
          { name: "HUBSPOT_CONNECTOR_ID", value: { connectorRef: "hubspot" } },
        ],
      };
      const manifestWithConnector = manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-1", profile: {} }],
        connectors: [
          { name: "hubspot", type: "http", config: { baseUrl: "https://x" } },
        ],
        services: [serviceWithConnectorRef],
      });
      const clients = noopClients();
      clients.connector = fakeClient("connector", {
        hubspot: {
          externalId: "conn-1",
          fields: connectorComparable.fromLive({
            id: "conn-1",
            name: "hubspot",
            context: "external",
          }),
        },
      });
      clients.service = fakeClient("service", {
        "priority-scorer": serviceLive("svc-1", {
          HUBSPOT_CONNECTOR_ID: "conn-1",
        }),
      });

      const result = await buildManifestPlan(
        manifestWithConnector,
        "t",
        clients
      );
      expect(
        result.ok && entryFor(result.value, "priority-scorer")?.verdict
      ).toBe("noop");
    });

    it("noop despite an unresolvable { connectorRef } sibling — degrades ONLY that entry, never the whole service — while still mechanism-checking a converged secretRef entry", async () => {
      const serviceMixed: HostedService = {
        name: "priority-scorer",
        image: "registry.example.com/priority-scorer:1.0",
        env: [
          { name: "API_KEY", value: { secretRef: "scorer-api-key" } },
          { name: "HUBSPOT_CONNECTOR_ID", value: { connectorRef: "hubspot" } },
        ],
      };
      const manifestWithConnector = manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-1", profile: {} }],
        connectors: [
          { name: "hubspot", type: "http", config: { baseUrl: "https://x" } },
        ],
        services: [serviceMixed],
        secrets: [
          {
            name: "scorer-api-key",
            scope: { kind: "service", owner: "priority-scorer" },
            external: true,
          },
        ],
      });
      const clients = noopClients();
      // connector is DECLARED (so it's a graph node/ordered before the
      // service) but has NO live match yet (still to be created in this
      // same plan) — resolveRef("connectorRef", "hubspot") stays
      // unresolved.
      clients.service = fakeClient("service", {
        "priority-scorer": serviceLive("svc-1", {
          API_KEY: {
            secretKeyRef: {
              name: "psec-service-priority-scorer",
              key: "scorer-api-key",
            },
          },
          HUBSPOT_CONNECTOR_ID: "conn-1",
        }),
      });

      const result = await buildManifestPlan(
        manifestWithConnector,
        "t",
        clients
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = entryFor(result.value, "priority-scorer");
        // Both entries converge: the secretRef var matches its live
        // secretKeyRef identity, and the unresolvable connectorRef entry
        // projects identically ("unresolved") on both sides — never a
        // spurious diff from the unresolvable sibling.
        expect(entry?.verdict).toBe("noop");
      }
    });

    // DEFECT 1 (fresh-context review, CRITICAL) — REQUIRED test: a service
    // with BOTH a secretRef var AND an endpoint-ref var; live has the
    // secretRef var drifted to plaintext -> verdict `update` (mechanism
    // mismatch caught DESPITE the unresolvable sibling), and the
    // endpoint-ref entry itself does not produce a spurious diff.
    it("catches secretRef mechanism drift on ONE entry even when a sibling endpoint-ref entry is unresolvable — the unresolvable entry never spuriously diffs", async () => {
      const serviceMixed: HostedService = {
        name: "priority-scorer",
        image: "registry.example.com/priority-scorer:1.0",
        env: [
          { name: "API_KEY", value: { secretRef: "scorer-api-key" } },
          {
            name: "HUBSPOT_DEALS_ENDPOINT_ID",
            value: {
              connectorRef: "hubspot",
              endpointMethod: "GET",
              endpointPath: "/crm/v3/objects/deals",
            },
          },
        ],
      };
      const manifestMixed = manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-1", profile: {} }],
        connectors: [
          { name: "hubspot", type: "http", config: { baseUrl: "https://x" } },
        ],
        services: [serviceMixed],
        secrets: [
          {
            name: "scorer-api-key",
            scope: { kind: "service", owner: "priority-scorer" },
            external: true,
          },
        ],
      });
      const PLAINTEXT_CREDENTIAL = "sk-live-yoizen-credential-DO-NOT-LEAK";
      const clients = noopClients();
      clients.connector = fakeClient("connector", {
        hubspot: {
          externalId: "conn-1",
          fields: connectorComparable.fromLive({
            id: "conn-1",
            name: "hubspot",
            context: "external",
          }),
        },
      });
      clients.service = fakeClient("service", {
        "priority-scorer": serviceLive("svc-1", {
          // THE INCIDENT: API_KEY drifted to a plaintext literal even
          // though the manifest declares `secretRef` for it.
          API_KEY: PLAINTEXT_CREDENTIAL,
          // The endpoint-ref var has SOME live value (whatever apply
          // resolved it to) — irrelevant, it must never be inspected.
          HUBSPOT_DEALS_ENDPOINT_ID: "ep-456",
        }),
      });

      const result = await buildManifestPlan(manifestMixed, "t", clients);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = entryFor(result.value, "priority-scorer");
        expect(entry?.verdict).toBe("update");
        const envDiff = entry?.diff.find((d) => d.field === "env");
        // Exactly the API_KEY entry mismatches (mechanism "plain" vs
        // "secretKeyRef"); the endpoint-ref entry contributes no diff of
        // its own — both sides project "unresolved" for it identically.
        const desiredEnv = envDiff?.desired as { name: string }[];
        const currentEnv = envDiff?.current as { name: string }[];
        expect(
          desiredEnv.find((e) => e.name === "HUBSPOT_DEALS_ENDPOINT_ID")
        ).toEqual(
          currentEnv.find((e) => e.name === "HUBSPOT_DEALS_ENDPOINT_ID")
        );
        expect(JSON.stringify(result.value)).not.toContain(
          PLAINTEXT_CREDENTIAL
        );
      }
    });
  });

  // T04 (manual-loops/provisioning-manifest-gaps.md, gap 4): systemVariable
  // — both `type` and `value` are faithfully comparable (unlike the
  // existence-only kinds above), so a value-only change is expected to
  // produce an `update` verdict, not silently no-op.
  describe("diff correctness per resource kind — systemVariable (T04)", () => {
    const systemVariable = {
      name: "escalation-threshold",
      type: "number",
      value: 5,
    };
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: {} }],
      systemVariables: [systemVariable],
    });

    it("create when absent live", async () => {
      const result = await buildManifestPlan(manifest, "t", noopClients());
      expect(
        result.ok && entryFor(result.value, "escalation-threshold")?.verdict
      ).toBe("create");
    });

    it("noop when a same-named systemVariable exists live with an identical value", async () => {
      const clients = noopClients();
      clients.systemVariable = fakeClient("systemVariable", {
        "escalation-threshold": {
          externalId: "sysvar-1",
          fields: systemVariableComparable.fromLive({
            id: "sysvar-1",
            name: "escalation-threshold",
            type: "number",
            value: 5,
          }),
        },
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      expect(
        result.ok && entryFor(result.value, "escalation-threshold")?.verdict
      ).toBe("noop");
    });

    it("update when the live value differs from the manifest's declared value", async () => {
      const clients = noopClients();
      clients.systemVariable = fakeClient("systemVariable", {
        "escalation-threshold": {
          externalId: "sysvar-1",
          fields: systemVariableComparable.fromLive({
            id: "sysvar-1",
            name: "escalation-threshold",
            type: "number",
            value: 3,
          }),
        },
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      if (result.ok) {
        const entry = entryFor(result.value, "escalation-threshold");
        expect(entry?.verdict).toBe("update");
        expect(entry?.diff).toEqual([
          { field: "value", current: 3, desired: 5 },
        ]);
      }
    });

    // LIVE-side secret-leak defense: a live `type: "secret"` variable whose
    // NAME collides with a manifest (non-secret) variable must NEVER echo its
    // plaintext value into plan output. It still diffs to an honest `update`
    // (type differs), but the serialized plan contains no live-secret trace.
    it("redacts a name-colliding live type:'secret' variable — update verdict, plaintext NEVER in the plan", async () => {
      const PLAINTEXT_SECRET = "live-secret-plaintext-DO-NOT-LEAK";
      const clients = noopClients();
      // Live row built with the REAL production projection (never hand-copied)
      // so this proves the redaction the actual client performs.
      clients.systemVariable = fakeClient("systemVariable", {
        "escalation-threshold": {
          externalId: "sysvar-secret-1",
          fields: systemVariableComparable.fromLive({
            id: "sysvar-secret-1",
            name: "escalation-threshold",
            type: "secret",
            value: PLAINTEXT_SECRET,
          }),
        },
      });

      const result = await buildManifestPlan(manifest, "t", clients);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = entryFor(result.value, "escalation-threshold");
        expect(entry?.verdict).toBe("update");
        // type diff surfaces the disagreement; live value is redacted
        // (current: undefined) — never the plaintext secret.
        const valueDiff = entry?.diff.find((d) => d.field === "value");
        expect(valueDiff?.current).toBeUndefined();
        expect(valueDiff?.desired).toBe(5);
        const typeDiff = entry?.diff.find((d) => d.field === "type");
        expect(typeDiff?.current).toBe("secret");
        // Full serialized plan MUST NOT contain the live secret anywhere.
        expect(JSON.stringify(result.value)).not.toContain(PLAINTEXT_SECRET);
      }
    });
  });

  // T05 (manual-loops/provisioning-manifest-gaps.md, gap 5), decision 6
  // ruling (2026-07-16) — cross-manifest/tenant route collision check.
  describe("route collision precondition (T05, gap 5, decision 6 ruling)", () => {
    function manifestWithServiceRoutes(
      pathPrefix: string
    ): IntegrationManifest {
      return manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-1", profile: {} }],
        services: [
          {
            name: "priority-scorer",
            image: "registry.example.com/priority-scorer:1.0",
            routes: [{ pathPrefix }],
          },
        ],
      });
    }

    it("no services declare routes -> the checker is never called", async () => {
      let listAllCalls = 0;
      const manifest = manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-1", profile: {} }],
        services: [
          {
            name: "priority-scorer",
            image: "registry.example.com/priority-scorer:1.0",
          },
        ],
      });

      const result = await buildManifestPlan(
        manifest,
        "tenant-a",
        noopClients(),
        undefined,
        undefined,
        undefined,
        {
          async listAll() {
            listAllCalls++;
            return { ok: true, value: [] };
          },
        }
      );
      expect(result.ok).toBe(true);
      expect(listAllCalls).toBe(0);
    });

    it("a pathPrefix owned by a DIFFERENT service/tenant is reported as route_collision", async () => {
      const manifest = manifestWithServiceRoutes("/priority-scorer");

      const result = await buildManifestPlan(
        manifest,
        "tenant-a",
        noopClients(),
        undefined,
        undefined,
        undefined,
        {
          async listAll() {
            return {
              ok: true,
              value: [
                {
                  pathPrefix: "/priority-scorer",
                  serviceName: "some-other-service",
                  tenantId: "tenant-b",
                },
              ],
            };
          },
        }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const precondition = result.value.preconditions.find(
          (p) => p.kind === "route_collision"
        );
        expect(precondition).toBeDefined();
        expect(precondition?.resourceKind).toBe("service");
        expect(precondition?.resourceName).toBe("priority-scorer");
        expect(precondition?.refValue).toBe("/priority-scorer");
        expect(precondition?.message).toContain("some-other-service");
        expect(precondition?.message).toContain("tenant-b");
      }
    });

    it("a pathPrefix owned by the SAME service/tenant is NOT a collision (normal reconcile)", async () => {
      const manifest = manifestWithServiceRoutes("/priority-scorer");

      const result = await buildManifestPlan(
        manifest,
        "tenant-a",
        noopClients(),
        undefined,
        undefined,
        undefined,
        {
          async listAll() {
            return {
              ok: true,
              value: [
                {
                  pathPrefix: "/priority-scorer",
                  serviceName: "priority-scorer",
                  tenantId: "tenant-a",
                },
              ],
            };
          },
        }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.value.preconditions.some((p) => p.kind === "route_collision")
        ).toBe(false);
      }
    });

    it("no matching live route anywhere -> no collision", async () => {
      const manifest = manifestWithServiceRoutes("/priority-scorer");

      const result = await buildManifestPlan(
        manifest,
        "tenant-a",
        noopClients(),
        undefined,
        undefined,
        undefined,
        {
          async listAll() {
            return { ok: true, value: [] };
          },
        }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.value.preconditions.some((p) => p.kind === "route_collision")
        ).toBe(false);
      }
    });

    it("a listAll() failure surfaces as a downstream_error precondition, never throws", async () => {
      const manifest = manifestWithServiceRoutes("/priority-scorer");

      const result = await buildManifestPlan(
        manifest,
        "tenant-a",
        noopClients(),
        undefined,
        undefined,
        undefined,
        {
          async listAll() {
            return { ok: false, error: "registry-service unreachable" };
          },
        }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const precondition = result.value.preconditions.find(
          (p) =>
            p.kind === "downstream_error" &&
            p.resourceName === "priority-scorer"
        );
        expect(precondition).toBeDefined();
      }
    });

    it("defaults to no collision detected when no checker is injected (NOOP)", async () => {
      const manifest = manifestWithServiceRoutes("/priority-scorer");
      const result = await buildManifestPlan(
        manifest,
        "tenant-a",
        noopClients()
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.value.preconditions.some((p) => p.kind === "route_collision")
        ).toBe(false);
      }
    });
  });

  describe("diff correctness per resource kind — workflow (content-aware)", () => {
    const workflow = {
      name: "ticket-router",
      definition: {
        application: "support",
        actions: [{ type: "jsFunction", code: "() => 1" }],
      },
    };
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      workflows: [workflow],
    });

    it("create when absent live", async () => {
      const result = await buildManifestPlan(manifest, "t", noopClients());
      expect(
        result.ok && entryFor(result.value, "ticket-router")?.verdict
      ).toBe("create");
    });

    it("noop when a same-named workflow exists live with matching application/actions", async () => {
      const clients = noopClients();
      clients.workflow = fakeClient("workflow", {
        "ticket-router": {
          externalId: "wf-1",
          fields: workflowComparable.fromLive(
            {
              id: "wf-1",
              name: "ticket-router",
              application: "support",
              actions: [{ type: "jsFunction", code: "() => 1" }],
            },
            workflow
          ),
        },
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      expect(
        result.ok && entryFor(result.value, "ticket-router")?.verdict
      ).toBe("noop");
    });

    // (a) manual-loops/provisioning-manifest-gaps-5.md — a live workflow
    // whose `actions` diverge from the manifest now produces a real
    // `update` verdict with a `FieldDiff` naming `actions` (T03's
    // existence-only comparator could never detect this).
    it("update when the live workflow's actions differ from the manifest, with a FieldDiff on 'actions'", async () => {
      const clients = noopClients();
      clients.workflow = fakeClient("workflow", {
        "ticket-router": {
          externalId: "wf-1",
          fields: workflowComparable.fromLive(
            {
              id: "wf-1",
              name: "ticket-router",
              application: "support",
              actions: [{ type: "jsFunction", code: "() => 2" }],
            },
            workflow
          ),
        },
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      const entry = result.ok
        ? entryFor(result.value, "ticket-router")
        : undefined;
      expect(entry?.verdict).toBe("update");
      expect(entry?.diff.some((d) => d.field === "actions")).toBe(true);
    });

    // (b) GRACEFUL DEGRADATION — a workflow referencing a resource that is
    // itself being CREATED in the same plan (no live id yet) cannot be
    // fully substituted, so the planner falls back to existence-only
    // comparison for THAT workflow instead of failing the plan or emitting
    // a spurious `update` against a still-symbolic definition.
    it("falls back to existence-only (noop) when a workflow's ref cannot be resolved at plan time", async () => {
      const workflowWithUnresolvedRef = {
        name: "ticket-router-with-ref",
        definition: {
          application: "support",
          actions: [
            { type: "agentCall", agentId: { agentRef: "agent-not-live-yet" } },
          ],
        },
      };
      const manifestWithRef = manifestWith({
        channels: [{ name: "http-in", type: "http", direction: "inbound" }],
        agents: [{ name: "agent-not-live-yet", profile: {} }],
        workflows: [workflowWithUnresolvedRef],
      });
      const clients = noopClients();
      // `agent` client stays the default `noopClients()` fake (no live
      // match) -> the agent is a plan-time `create`, so its real id is
      // NOT available in `resolvedIds` yet when the workflow is reached.
      clients.workflow = fakeClient("workflow", {
        "ticket-router-with-ref": {
          externalId: "wf-2",
          // Deliberately non-empty/mismatched — the existence-only fallback
          // must ignore this entirely (never diff it against `desired`).
          fields: { application: "support", actions: [] },
        },
      });
      const result = await buildManifestPlan(manifestWithRef, "t", clients);
      const entry = result.ok
        ? entryFor(result.value, "ticket-router-with-ref")
        : undefined;
      expect(entry?.verdict).toBe("noop");
    });
  });
});
