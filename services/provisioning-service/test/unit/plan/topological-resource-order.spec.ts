import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import { computeResourceOrder } from "../../../src/modules/plan/lib/topological-resource-order";

function baseManifest(): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "order-test" },
    spec: {
      channels: [
        { name: "support-telegram", type: "telegram", direction: "inbound" },
      ],
      connectors: [{ name: "hubspot", type: "http" }],
      agents: [{ name: "support-agent", profile: {} }],
      knowledgeBases: [],
      services: [
        { name: "priority-scorer", image: "registry.example.com/x:1" },
      ],
      systemVariables: [],
      mcpServers: [],
      workflows: [
        {
          name: "ticket-router",
          definition: {
            steps: [
              { channelRef: "support-telegram" },
              { agentRef: "support-agent" },
              { serviceRef: "priority-scorer" },
            ],
          },
        },
      ],
      secrets: [],
    },
  };
}

describe("computeResourceOrder", () => {
  it("orders resources with the base section precedence when there are no cross-refs", () => {
    const manifest = baseManifest();
    manifest.spec.workflows[0]!.definition = { steps: [] }; // strip refs

    const result = computeResourceOrder(manifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const kinds = result.value.map((r) => r.kind);
      expect(kinds).toEqual([
        "channel",
        "connector",
        "agent",
        "service",
        "workflow",
      ]);
    }
  });

  it("orders a referenced resource BEFORE the workflow that references it", () => {
    const result = computeResourceOrder(baseManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.value.map((r) => r.name);
      const workflowIndex = names.indexOf("ticket-router");
      expect(names.indexOf("support-telegram")).toBeLessThan(workflowIndex);
      expect(names.indexOf("support-agent")).toBeLessThan(workflowIndex);
      expect(names.indexOf("priority-scorer")).toBeLessThan(workflowIndex);
    }
  });

  it("is deterministic across repeated calls on the same manifest", () => {
    const manifest = baseManifest();
    const first = computeResourceOrder(manifest);
    const second = computeResourceOrder(manifest);
    expect(first).toEqual(second);
  });

  it("includes every declared resource exactly once", () => {
    const result = computeResourceOrder(baseManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(5);
    }
  });

  it("T04 (gap 4) — a systemVariable is a leaf node ordered before workflows, with no dependency edges", () => {
    const manifest = baseManifest();
    manifest.spec.systemVariables = [
      { name: "escalation-threshold", type: "number", value: 5 },
    ];

    const result = computeResourceOrder(manifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const kinds = result.value.map((r) => r.kind);
      expect(kinds).toEqual([
        "channel",
        "connector",
        "agent",
        "service",
        "systemVariable",
        "workflow",
      ]);
      const names = result.value.map((r) => r.name);
      expect(names.indexOf("escalation-threshold")).toBeLessThan(
        names.indexOf("ticket-router")
      );
    }
  });

  it("T06 (gap 6) — mcpServer is ordered BEFORE the agent that enables it and the workflow that calls it", () => {
    const manifest = baseManifest();
    manifest.spec.mcpServers = [
      {
        name: "github-mcp",
        transport_type: "http",
        url: "https://mcp.example.com",
      },
    ];
    manifest.spec.agents = [
      {
        name: "support-agent",
        profile: {},
        enabledMcpServerRefs: ["github-mcp"],
      },
    ];
    manifest.spec.workflows[0]!.definition = {
      steps: [
        { channelRef: "support-telegram" },
        { agentRef: "support-agent" },
        { serviceRef: "priority-scorer" },
        {
          activity: "mcpCall",
          args: { serverId: { mcpServerRef: "github-mcp" } },
        },
      ],
    };

    const result = computeResourceOrder(manifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const kinds = result.value.map((r) => r.kind);
      expect(kinds).toEqual([
        "channel",
        "connector",
        "mcpServer",
        "agent",
        "service",
        "workflow",
      ]);
      const names = result.value.map((r) => r.name);
      expect(names.indexOf("github-mcp")).toBeLessThan(
        names.indexOf("support-agent")
      );
      expect(names.indexOf("github-mcp")).toBeLessThan(
        names.indexOf("ticket-router")
      );
    }
  });

  it("returns a typed CycleDetectedError instead of hanging when the ref graph has a cycle", () => {
    // Construct a cycle using only the 4 existing ref types: an agent's
    // arbitrary `profile` record embeds a `serviceRef`, and — for this
    // synthetic test only — we force an edge back by also embedding an
    // `agentRef` inside the service's otherwise-strict shape via a raw
    // object cast, proving the resolver treats a cycle as a typed error at
    // the graph level, not by relying on impossible-to-construct schemas.
    const manifest = baseManifest();
    (manifest.spec.agents[0] as { profile: Record<string, unknown> }).profile =
      { serviceRef: "priority-scorer" };
    (manifest.spec.services[0] as unknown as { agentRef: string }).agentRef =
      "support-agent";

    const result = computeResourceOrder(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("cycle_detected");
      expect(result.error.cycle.join(" -> ")).toContain("agent:support-agent");
      expect(result.error.cycle.join(" -> ")).toContain(
        "service:priority-scorer"
      );
    }
  });
});
