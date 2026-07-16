import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { Agent } from "@yoizen/shared";
import {
  type AgentDto,
  agentComparable,
} from "../../../src/modules/plan/lib/comparable-fields";

// T04 (manual-loops/provisioning-manifest-gaps-2.md, gap 4) —
// enabledMcpTools/toolDescriptionOverrides upgrade agentComparable from pure
// existence-only to comparable for exactly these two fields; everything else
// (system_prompt/model_config/knowledge-base UUID links) stays
// existence-only, unchanged from T03.

describe("agentComparable", () => {
  it("projects nothing when the manifest declares neither field (unchanged existence-only behavior)", () => {
    const manifestAgent: Agent = { name: "support-agent", profile: {} };
    const liveAgent: AgentDto = { id: "agent-1", name: "support-agent" };

    expect(agentComparable.fromManifest(manifestAgent)).toEqual({});
    expect(agentComparable.fromLive(liveAgent, manifestAgent)).toEqual({});
  });

  it("projects enabledMcpTools on both sides, sorted deterministically, when the manifest declares it", () => {
    const manifestAgent: Agent = {
      name: "support-agent",
      profile: {},
      enabledMcpTools: {
        "github-mcp": ["read_file", "search_code"],
        "deepwiki-mcp": null,
      },
    };
    const liveAgent: AgentDto = {
      id: "agent-1",
      name: "support-agent",
      enabled_mcp_tools: {
        "deepwiki-mcp": null,
        "github-mcp": ["search_code", "read_file"],
      },
    };

    const desired = agentComparable.fromManifest(manifestAgent);
    const live = agentComparable.fromLive(liveAgent, manifestAgent);
    expect(desired).toEqual(live);
    expect(desired).toEqual({
      enabledMcpTools: {
        "deepwiki-mcp": null,
        "github-mcp": ["read_file", "search_code"],
      },
    });
  });

  it("projects toolDescriptionOverrides on both sides when the manifest declares it", () => {
    const manifestAgent: Agent = {
      name: "support-agent",
      profile: {},
      toolDescriptionOverrides: {
        "github-mcp:search_code": "Search the repo.",
        http_fetch: "Fetch a URL.",
      },
    };
    const liveAgent: AgentDto = {
      id: "agent-1",
      name: "support-agent",
      tool_description_overrides: {
        http_fetch: "Fetch a URL.",
        "github-mcp:search_code": "Search the repo.",
      },
    };

    expect(agentComparable.fromManifest(manifestAgent)).toEqual(
      agentComparable.fromLive(liveAgent, manifestAgent)
    );
  });

  it("never projects enabledMcpTools/toolDescriptionOverrides when the manifest omits them, even if the live agent has a value (declared-gate, matches serviceComparable's scaling-field idiom)", () => {
    const manifestAgent: Agent = { name: "support-agent", profile: {} };
    const liveAgent: AgentDto = {
      id: "agent-1",
      name: "support-agent",
      enabled_mcp_tools: { "github-mcp": ["search_code"] },
      tool_description_overrides: { http_fetch: "Fetch a URL." },
    };

    expect(agentComparable.fromLive(liveAgent, manifestAgent)).toEqual({});
  });

  it("a tools-only change (manifest differs from live) produces a diffable projection (honest update signal)", () => {
    const manifestAgent: Agent = {
      name: "support-agent",
      profile: {},
      enabledMcpTools: { "github-mcp": ["search_code", "read_file"] },
    };
    const liveAgent: AgentDto = {
      id: "agent-1",
      name: "support-agent",
      enabled_mcp_tools: { "github-mcp": ["search_code"] },
    };

    const desired = agentComparable.fromManifest(manifestAgent);
    const live = agentComparable.fromLive(liveAgent, manifestAgent);
    expect(desired).not.toEqual(live);
  });

  it("still excludes system_prompt/model_config/knowledge_base_ids — no faithful mapping yet (unchanged T03 limitation)", () => {
    const manifestAgent: Agent = {
      name: "support-agent",
      profile: { system_prompt: "help", model_config: { model: "gpt-4" } },
      knowledgeBaseRefs: ["kb-1"],
      enabledMcpTools: { "github-mcp": null },
    };

    const projection = agentComparable.fromManifest(manifestAgent);
    expect(Object.keys(projection)).not.toContain("system_prompt");
    expect(Object.keys(projection)).not.toContain("model_config");
    expect(Object.keys(projection)).not.toContain("knowledgeBaseRefs");
    expect(Object.keys(projection)).not.toContain("knowledge_base_ids");
  });
});
