import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import { computeResourceOrder } from "../../../src/modules/plan/lib/topological-resource-order";
import { buildUndeployOrder } from "../../../src/modules/undeploy/lib/build-undeploy-order";

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
      skills: [],
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

describe("buildUndeployOrder", () => {
  it("is the EXACT reverse of the apply order for a manifest with no knowledge bases", () => {
    const manifest = baseManifest();
    const applyOrder = computeResourceOrder(manifest);
    const undeployOrder = buildUndeployOrder(manifest);

    expect(applyOrder.ok).toBe(true);
    expect(undeployOrder.ok).toBe(true);
    if (!applyOrder.ok || !undeployOrder.ok) {
      return;
    }
    expect(undeployOrder.value.map((t) => `${t.kind}:${t.name}`)).toEqual(
      [...applyOrder.value].reverse().map((r) => `${r.kind}:${r.name}`)
    );
  });

  it("deletes a referencing workflow BEFORE the resources it references", () => {
    const result = buildUndeployOrder(baseManifest());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const names = result.value.map((t) => t.name);
    const workflowIndex = names.indexOf("ticket-router");
    expect(workflowIndex).toBeLessThan(names.indexOf("support-telegram"));
    expect(workflowIndex).toBeLessThan(names.indexOf("support-agent"));
    expect(workflowIndex).toBeLessThan(names.indexOf("priority-scorer"));
  });

  it("places knowledge bases AFTER agents and BEFORE connectors (reverse of apply's KB hook)", () => {
    const manifest = baseManifest();
    manifest.spec.knowledgeBases = [
      {
        name: "support-kb",
        documents: [
          { name: "faq", source: { type: "inline", content: "hello" } },
        ],
      },
    ];

    const result = buildUndeployOrder(manifest);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const keys = result.value.map((t) => `${t.kind}:${t.name}`);
    expect(keys.indexOf("knowledgeBase:support-kb")).toBeGreaterThan(
      keys.indexOf("agent:support-agent")
    );
    expect(keys.indexOf("knowledgeBase:support-kb")).toBeLessThan(
      keys.indexOf("connector:hubspot")
    );
  });

  it("still emits knowledge bases when the manifest has NO post-connector resource", () => {
    const manifest = baseManifest();
    manifest.spec.agents = [];
    manifest.spec.services = [];
    manifest.spec.workflows = [];
    manifest.spec.knowledgeBases = [
      {
        name: "library-kb",
        documents: [
          { name: "faq", source: { type: "inline", content: "hello" } },
        ],
      },
    ];

    const result = buildUndeployOrder(manifest);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const keys = result.value.map((t) => `${t.kind}:${t.name}`);
    expect(keys).toEqual([
      "knowledgeBase:library-kb",
      "connector:hubspot",
      "channel:support-telegram",
    ]);
  });

  it("carries each resource's `external` flag through so the engine can skip it", () => {
    const manifest = baseManifest();
    manifest.spec.connectors[0]!.external = true;
    manifest.spec.knowledgeBases = [
      {
        name: "shared-kb",
        documents: [
          { name: "faq", source: { type: "inline", content: "hello" } },
        ],
        external: true,
      },
    ];

    const result = buildUndeployOrder(manifest);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const external = result.value
      .filter((t) => t.external)
      .map((t) => `${t.kind}:${t.name}`);
    expect(external.sort()).toEqual([
      "connector:hubspot",
      "knowledgeBase:shared-kb",
    ]);
  });

  it("surfaces a dependency cycle as a typed error instead of hanging", () => {
    const manifest = baseManifest();
    // channel -> agent (channel config ref) and agent -> channel (profile
    // ref): a real two-node cycle in the `collectSymbolicRefs` graph.
    manifest.spec.channels[0]!.config = { agentRef: "support-agent" };
    manifest.spec.agents[0]!.profile = {
      handoff: { channelRef: "support-telegram" },
    };

    const result = buildUndeployOrder(manifest);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("cycle_detected");
  });
});
