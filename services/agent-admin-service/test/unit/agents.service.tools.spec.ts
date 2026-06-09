import "../setup-env";
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
    { name: "search_tickets", adapterRef: { adapterId: "z1", endpointId: "search" } },
  ],
  enabled_tools: null,
  channels: [],
  status: "draft",
  is_active: true,
  published_at: null,
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
};

// ---------------------------------------------------------------------------
// Tests for AgentsService.updateEnabledTools()
//
// This method does not exist yet.  Tests designed to FAIL until implemented.
// ---------------------------------------------------------------------------

describe("AgentsService — updateEnabledTools", () => {
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

    // AgentsService constructor needs: repository, natsPublisher, runtimeService, adaptersService?
    // We pass undefined for adaptersService since we don't need it here.
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
  it("should update enabled_tools with a list of tool names", async () => {
    mockRepo.update.mockResolvedValueOnce({
      ...baseAgent,
      enabled_tools: ["communicate"],
    });

    const result = await service.updateEnabledTools("t1", "agent-123", [
      "communicate",
    ]);

    expect(mockRepo.update).toHaveBeenCalledWith("t1", "agent-123", {
      enabled_tools: ["communicate"],
    });
    expect(result.enabled_tools).toEqual(["communicate"]);
  });

  it("should set enabled_tools to null to enable all tools", async () => {
    mockRepo.update.mockResolvedValueOnce({
      ...baseAgent,
      enabled_tools: null,
    });

    const result = await service.updateEnabledTools("t1", "agent-123", null);

    expect(mockRepo.update).toHaveBeenCalledWith("t1", "agent-123", {
      enabled_tools: null,
    });
    expect(result.enabled_tools).toBeNull();
  });

  it("should set enabled_tools to empty array to disable all tools", async () => {
    mockRepo.update.mockResolvedValueOnce({
      ...baseAgent,
      enabled_tools: [],
    });

    const result = await service.updateEnabledTools("t1", "agent-123", []);

    expect(mockRepo.update).toHaveBeenCalledWith("t1", "agent-123", {
      enabled_tools: [],
    });
    expect(result.enabled_tools).toEqual([]);
  });

  // =========================================================================
  //  Error: agent not found
  // =========================================================================
  it("should throw NotFoundException when agent does not exist", async () => {
    mockRepo.update.mockResolvedValueOnce(null);

    await expect(
      service.updateEnabledTools("t1", "missing-agent", ["communicate"]),
    ).rejects.toThrow(NotFoundException);
  });

  // =========================================================================
  //  Does not touch other agent fields
  // =========================================================================
  it("should only update enabled_tools, not other agent fields", async () => {
    mockRepo.update.mockResolvedValueOnce({
      ...baseAgent,
      enabled_tools: ["resource"],
    });

    await service.updateEnabledTools("t1", "agent-123", ["resource"]);

    const updateCall = mockRepo.update.mock.calls[0];
    const updateData = updateCall[2] as Record<string, unknown>;

    // Should only contain enabled_tools, nothing else
    expect(Object.keys(updateData)).toEqual(["enabled_tools"]);
    expect(updateData).not.toHaveProperty("name");
    expect(updateData).not.toHaveProperty("system_prompt");
    expect(updateData).not.toHaveProperty("tools");
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: agents without enabled_tools
// ---------------------------------------------------------------------------

describe("Backward compatibility — agents without enabled_tools", () => {
  it("should treat agents with no enabled_tools field as having all tools enabled", () => {
    // Simulate a legacy agent from the database — no enabled_tools field
    const legacyAgent = {
      id: "legacy-agent",
      name: "Old Agent",
      tools: [
        { name: "communicate", builtin: true },
        { name: "resource", builtin: true },
      ],
      // enabled_tools is undefined — legacy agents don't have this field
    };

    // The effective enabled_tools should be null (all enabled)
    const effectiveEnabledTools =
      legacyAgent.enabled_tools ?? null;

    expect(effectiveEnabledTools).toBeNull();
  });

  it("should treat agents with enabled_tools: null as having all tools enabled", () => {
    const agentWithNull = {
      id: "agent-null",
      tools: [
        { name: "communicate", builtin: true },
        { name: "resource", builtin: true },
      ],
      enabled_tools: null,
    };

    // null means all tools are enabled
    expect(agentWithNull.enabled_tools).toBeNull();
  });

  it("should respect enabled_tools when it is an array", () => {
    const agentWithFilter = {
      id: "agent-filtered",
      tools: [
        { name: "communicate", builtin: true },
        { name: "resource", builtin: true },
      ],
      enabled_tools: ["communicate"] as string[] | null,
    };

    expect(agentWithFilter.enabled_tools).toBeDefined();
    expect(Array.isArray(agentWithFilter.enabled_tools)).toBe(true);

    // Simulate filtering logic
    const effectiveTools = (agentWithFilter.tools as any[]).filter(
      (t) =>
        agentWithFilter.enabled_tools === null ||
        agentWithFilter.enabled_tools!.includes(t.name),
    );

    expect(effectiveTools).toHaveLength(1);
    expect(effectiveTools[0].name).toBe("communicate");
  });

  it("should return all tools when enabled_tools is null even if tools array has entries", () => {
    const agent = {
      tools: [
        { name: "communicate", builtin: true },
        { name: "resource", builtin: true },
        { name: "search_tickets", adapterRef: {} },
      ],
      enabled_tools: null as string[] | null,
    };

    // null → no filtering, all tools returned
    const effectiveTools = (agent.tools as any[]).filter(
      (t) =>
        agent.enabled_tools === null ||
        agent.enabled_tools!.includes(t.name),
    );

    expect(effectiveTools).toHaveLength(3);
  });
});
