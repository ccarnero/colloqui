import "../setup-env";
// Enable the feature flag for this test suite (config uses lazy getters so env var must be set before Service creation)
process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED = "true";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NotFoundException } from "@nestjs/common";

// ---------------------------------------------------------------------------
// Mock @yoizen/observability before importing service
// ---------------------------------------------------------------------------
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockPinoLoggerService {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
    verbose = mock(() => {});
    fatal = mock(() => {});
  },
}));

import { AgentsService } from "../../src/modules/agents/agents.service";
import { AGENTS_REPOSITORY } from "../../src/modules/agents/agents.repository.interface";
import type {
  IAgent,
  IAgentsRepository,
} from "../../src/modules/agents/agents.repository.interface";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseAgent: IAgent = {
  id: "agent-123",
  name: "Sales Assistant",
  description: "Helps with sales",
  system_prompt: "You are a sales assistant",
  model_config: {},
  tools: [
    { name: "communicate", builtin: true },
    { name: "resource", builtin: true },
    { name: "memory", builtin: true },
    { name: "search_tickets", adapterRef: { adapterId: "z1", endpointId: "search" } },
  ],
  enabled_tools: null,
  enabled_mcp_servers: null,
  tool_description_overrides: null,
  channels: [],
  status: "draft",
  is_active: true,
  published_at: null,
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
};

const agentWithOverrides: IAgent = {
  ...baseAgent,
  tool_description_overrides: {
    memory: "Store/retrieve conversation data (custom)",
    communicate: "Send messages (overridden)",
  },
};

// ---------------------------------------------------------------------------
// Tests for AgentsService.updateToolDescriptionOverrides()
// ---------------------------------------------------------------------------

describe("AgentsService — updateToolDescriptionOverrides", () => {
  let service: AgentsService;
  let mockRepo: {
    findAll: ReturnType<typeof mock>;
    findById: ReturnType<typeof mock>;
    create: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
    delete: ReturnType<typeof mock>;
    publish: ReturnType<typeof mock>;
    unpublish: ReturnType<typeof mock>;
  };
  let mockNats: {
    publishAgentPublished: ReturnType<typeof mock>;
    publishAgentUnpublished: ReturnType<typeof mock>;
  };
  let mockRuntime: {
    listMemoryProposals: ReturnType<typeof mock>;
    reviewMemoryProposal: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    mockRepo = {
      findAll: mock(() => Promise.resolve({ agents: [], total: 0 })),
      findById: mock(() => Promise.resolve(null)),
      create: mock(() => Promise.resolve(baseAgent)),
      update: mock(() => Promise.resolve(null)),
      delete: mock(() => Promise.resolve(true)),
      publish: mock(() => Promise.resolve(null)),
      unpublish: mock(() => Promise.resolve(null)),
    };
    mockNats = {
      publishAgentPublished: mock(() => Promise.resolve()),
      publishAgentUnpublished: mock(() => Promise.resolve()),
    };
    mockRuntime = {
      listMemoryProposals: mock(() => Promise.resolve({ proposals: [] })),
      reviewMemoryProposal: mock(() =>
        Promise.resolve({ success: true }),
      ),
    };

    service = new AgentsService(
      mockRepo as any,
      mockNats as any,
      mockRuntime as any,
      undefined,
    );
  });

  // =========================================================================
  //  Happy path
  // =========================================================================

  it("should update tool_description_overrides with a Record<string, string>", async () => {
    const overrides: Record<string, string> = {
      memory: "Store/retrieve conversation data (custom)",
    };
    mockRepo.update.mockResolvedValueOnce({
      ...baseAgent,
      tool_description_overrides: overrides,
    });

    const result = await service.updateToolDescriptionOverrides("t1", "agent-123", overrides);

    expect(mockRepo.update).toHaveBeenCalledWith("t1", "agent-123", {
      tool_description_overrides: overrides,
    });
    expect(result.tool_description_overrides).toEqual(overrides);
  });

  it("should update multiple overrides in one call", async () => {
    const overrides: Record<string, string> = {
      memory: "Memory tool description",
      communicate: "Communicate tool description",
      resource: "Resource tool description",
    };
    mockRepo.update.mockResolvedValueOnce({
      ...baseAgent,
      tool_description_overrides: overrides,
    });

    const result = await service.updateToolDescriptionOverrides("t1", "agent-123", overrides);

    expect(mockRepo.update).toHaveBeenCalledWith("t1", "agent-123", {
      tool_description_overrides: overrides,
    });
    expect(Object.keys(result.tool_description_overrides!)).toHaveLength(3);
  });

  it("should return the updated agent with the overrides", async () => {
    const overrides: Record<string, string> = { memory: "Custom memory desc" };
    mockRepo.update.mockResolvedValueOnce(agentWithOverrides);

    const result = await service.updateToolDescriptionOverrides("t1", "agent-123", overrides);

    expect(result).toEqual(agentWithOverrides);
    expect(result.tool_description_overrides).toEqual(agentWithOverrides.tool_description_overrides);
  });

  // =========================================================================
  //  Null clears all overrides
  // =========================================================================

  it("should set tool_description_overrides to null to clear all overrides", async () => {
    mockRepo.update.mockResolvedValueOnce({
      ...agentWithOverrides,
      tool_description_overrides: null,
    });

    const result = await service.updateToolDescriptionOverrides("t1", "agent-123", null);

    expect(mockRepo.update).toHaveBeenCalledWith("t1", "agent-123", {
      tool_description_overrides: null,
    });
    expect(result.tool_description_overrides).toBeNull();
  });

  // =========================================================================
  //  Error: agent not found
  // =========================================================================

  it("should throw NotFoundException when agent does not exist", async () => {
    mockRepo.update.mockResolvedValueOnce(null);

    await expect(
      service.updateToolDescriptionOverrides("t1", "missing-agent", { memory: "desc" }),
    ).rejects.toThrow(NotFoundException);
  });

  // =========================================================================
  //  Does not touch other agent fields
  // =========================================================================

  it("should only update tool_description_overrides, not other agent fields", async () => {
    const overrides: Record<string, string> = { memory: "Custom desc" };
    mockRepo.update.mockResolvedValueOnce({
      ...baseAgent,
      tool_description_overrides: overrides,
    });

    await service.updateToolDescriptionOverrides("t1", "agent-123", overrides);

    const updateCall = mockRepo.update.mock.calls[0];
    const updateData = updateCall[2] as Record<string, unknown>;

    // Should only contain tool_description_overrides, nothing else
    expect(Object.keys(updateData)).toEqual(["tool_description_overrides"]);
    expect(updateData).not.toHaveProperty("name");
    expect(updateData).not.toHaveProperty("system_prompt");
    expect(updateData).not.toHaveProperty("tools");
    expect(updateData).not.toHaveProperty("enabled_tools");
  });

  // =========================================================================
  //  Legacy agents: undefined tool_description_overrides
  // =========================================================================

  it("should treat agents with no tool_description_overrides field as null (all defaults)", () => {
    const legacyAgent = {
      id: "legacy",
      name: "Legacy Agent",
      tools: [],
      // tool_description_overrides is undefined — legacy agent
    };

    const effectiveOverrides =
      (legacyAgent as any).tool_description_overrides ?? null;

    expect(effectiveOverrides).toBeNull();
  });
});
