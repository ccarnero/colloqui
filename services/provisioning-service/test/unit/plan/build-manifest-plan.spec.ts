import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
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
  serviceComparable,
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
    const service = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "API_KEY", secretRef: "scorer-api-key" }],
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

    it("create when absent live", async () => {
      const result = await buildManifestPlan(manifest, "t", noopClients());
      expect(
        result.ok && entryFor(result.value, "priority-scorer")?.verdict
      ).toBe("create");
    });

    it("noop when live env var NAMES match (live values are dropped by fromLive)", async () => {
      const clients = noopClients();
      clients.service = fakeClient("service", {
        "priority-scorer": {
          externalId: "svc-1",
          fields: serviceComparable.fromLive({
            id: "svc-1",
            name: "priority-scorer",
            image: "registry.example.com/priority-scorer:1.0",
            // live value present here MUST NOT leak into the projection
            envVars: { API_KEY: "super-secret-value" },
          }),
        },
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      expect(
        result.ok && entryFor(result.value, "priority-scorer")?.verdict
      ).toBe("noop");
    });

    it("update when the set of env var names changed", async () => {
      const clients = noopClients();
      clients.service = fakeClient("service", {
        "priority-scorer": {
          externalId: "svc-1",
          fields: serviceComparable.fromLive({
            id: "svc-1",
            name: "priority-scorer",
            image: "registry.example.com/priority-scorer:1.0",
            envVars: { OTHER_VAR: "x" },
          }),
        },
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      if (result.ok) {
        const entry = entryFor(result.value, "priority-scorer");
        expect(entry?.verdict).toBe("update");
        expect(entry?.diff.map((d) => d.field)).toEqual(["envNames"]);
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

  describe("diff correctness per resource kind — workflow (existence-only)", () => {
    const workflow = {
      name: "ticket-router",
      definition: { steps: [{ type: "agentCall", agentRef: "agent-1" }] },
    };
    const manifest = manifestWith({
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      agents: [{ name: "agent-1", profile: {} }],
      workflows: [workflow],
    });

    it("create when absent live", async () => {
      const result = await buildManifestPlan(manifest, "t", noopClients());
      expect(
        result.ok && entryFor(result.value, "ticket-router")?.verdict
      ).toBe("create");
    });

    it("noop when a same-named workflow exists live", async () => {
      const clients = noopClients();
      clients.workflow = fakeClient("workflow", {
        "ticket-router": {
          externalId: "wf-1",
          fields: workflowComparable.fromLive({
            id: "wf-1",
            name: "ticket-router",
          }),
        },
      });
      const result = await buildManifestPlan(manifest, "t", clients);
      expect(
        result.ok && entryFor(result.value, "ticket-router")?.verdict
      ).toBe("noop");
    });
  });
});
