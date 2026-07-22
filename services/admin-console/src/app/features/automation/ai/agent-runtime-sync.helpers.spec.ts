import type { IAgent } from "../../../core/models/agent.model";
import {
  deriveAgentRuntimeState,
  mapRuntimeStateToHealth,
} from "./agent-runtime-sync.helpers";

function buildAgent(overrides: Partial<IAgent> = {}): IAgent {
  return {
    id: "agent-1",
    name: "Sales Agent",
    description: "Desc",
    system_prompt: "Prompt",
    model_config: {
      rules: "Rules",
      soul: "Soul",
      subagents: [],
      llm: { provider: "openai", model: "gpt-4o", connectorId: null },
    },
    tools: [],
    enabled_tools: null,
    enabled_mcp_servers: null,
    enabled_mcp_tools: null,
    tool_description_overrides: null,
    channels: [],
    status: "published",
    is_active: true,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_config: null,
    ...overrides,
  };
}

describe("deriveAgentRuntimeState", () => {
  it("returns unsynced when the gateway is unhealthy, regardless of agent fields", () => {
    const agent = buildAgent({ status: "published" });
    const result = deriveAgentRuntimeState(agent, false);
    expect(result.state).toBe("unsynced");
  });

  it("returns draft when the gateway is healthy but the agent is not published", () => {
    const agent = buildAgent({ status: "draft" });
    const result = deriveAgentRuntimeState(agent, true);
    expect(result.state).toBe("draft");
  });

  it("returns misconfigured when published but missing provider/model", () => {
    const agent = buildAgent({
      status: "published",
      model_config: {
        rules: "Rules",
        soul: "Soul",
        subagents: [],
        llm: { provider: "", model: "", connectorId: null },
      },
    });
    const result = deriveAgentRuntimeState(agent, true);
    expect(result.state).toBe("misconfigured");
    expect(result.detail).toContain("provider");
    expect(result.detail).toContain("model");
  });

  it("returns synced when the gateway is healthy, the agent is published, and provider/model are set", () => {
    const agent = buildAgent({ status: "published" });
    const result = deriveAgentRuntimeState(agent, true);
    expect(result.state).toBe("synced");
  });
});

describe("mapRuntimeStateToHealth", () => {
  it("maps synced to ok", () => {
    expect(mapRuntimeStateToHealth("synced")).toBe("ok");
  });

  it("maps draft to idle", () => {
    expect(mapRuntimeStateToHealth("draft")).toBe("idle");
  });

  it("maps unsynced to warn", () => {
    expect(mapRuntimeStateToHealth("unsynced")).toBe("warn");
  });

  it("maps misconfigured to error", () => {
    expect(mapRuntimeStateToHealth("misconfigured")).toBe("error");
  });

  it("falls back transient states (checking/unknown) to idle without throwing", () => {
    expect(mapRuntimeStateToHealth("checking")).toBe("idle");
    expect(mapRuntimeStateToHealth("unknown")).toBe("idle");
  });
});
