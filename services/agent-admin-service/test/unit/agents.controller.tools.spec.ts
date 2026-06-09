import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";

// ---------------------------------------------------------------------------
// Tests for PATCH /admin/agents/:id/tools
//
// This endpoint does not exist yet.  The tests are designed to FAIL until
// the controller method and DTO are implemented.
// ---------------------------------------------------------------------------

const load = async () => {
  const { AgentsController } = await import(
    "../../src/modules/agents/agents.controller"
  );
  const { AgentsService } = await import(
    "../../src/modules/agents/agents.service"
  );
  return { AgentsController, AgentsService };
};

// ── Fixtures ──────────────────────────────────────────────────────────────

const existingAgent = {
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
  created_at: new Date(),
  updated_at: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("AgentsController — PATCH /agents/:id/tools", () => {
  let AgentsController: Awaited<ReturnType<typeof load>>["AgentsController"];
  let controller: InstanceType<typeof AgentsController>;
  let agentsService: {
    findAll: ReturnType<typeof mock>;
    findById: ReturnType<typeof mock>;
    create: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
    delete: ReturnType<typeof mock>;
    publish: ReturnType<typeof mock>;
    unpublish: ReturnType<typeof mock>;
    chat: ReturnType<typeof mock>;
    updateEnabledTools: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    const mod = await load();
    AgentsController = mod.AgentsController;
    agentsService = {
      findAll: mock(() => Promise.resolve({ agents: [], total: 0 })),
      findById: mock(() => Promise.resolve(null)),
      create: mock(() => Promise.resolve({ id: "new" })),
      update: mock(() => Promise.resolve({ id: "u1" })),
      delete: mock(() => Promise.resolve()),
      publish: mock(() => Promise.resolve({ id: "p1" })),
      unpublish: mock(() => Promise.resolve({ id: "u1" })),
      chat: mock(() =>
        Promise.resolve({ reply: "ok", tool_calls: [] }),
      ),
      updateEnabledTools: mock(() =>
        Promise.resolve({ ...existingAgent, enabled_tools: ["communicate"] }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: mod.AgentsService, useValue: agentsService }],
    }).compile();
    controller = moduleRef.get(AgentsController);
  });

  // =========================================================================
  //  Happy path
  // =========================================================================
  it("should delegate enabled_tools update to the service", async () => {
    const dto = { enabled_tools: ["communicate", "resource"] };

    // This will fail because controller.updateEnabledTools does not exist yet
    const result = await controller.updateEnabledTools("tenant-1", "agent-123", dto);

    expect(agentsService.updateEnabledTools).toHaveBeenCalledWith(
      "tenant-1",
      "agent-123",
      ["communicate", "resource"],
    );
    expect(result.enabled_tools).toEqual(["communicate"]);
  });

  it("should accept enabled_tools as null to enable all tools", async () => {
    agentsService.updateEnabledTools.mockResolvedValueOnce({
      ...existingAgent,
      enabled_tools: null,
    });

    const dto = { enabled_tools: null };

    const result = await controller.updateEnabledTools("tenant-1", "agent-123", dto);

    expect(agentsService.updateEnabledTools).toHaveBeenCalledWith(
      "tenant-1",
      "agent-123",
      null,
    );
    expect(result.enabled_tools).toBeNull();
  });

  it("should accept an empty array to disable all tools", async () => {
    agentsService.updateEnabledTools.mockResolvedValueOnce({
      ...existingAgent,
      enabled_tools: [],
    });

    const dto = { enabled_tools: [] };

    const result = await controller.updateEnabledTools("tenant-1", "agent-123", dto);

    expect(agentsService.updateEnabledTools).toHaveBeenCalledWith(
      "tenant-1",
      "agent-123",
      [],
    );
    expect(result.enabled_tools).toEqual([]);
  });

  // =========================================================================
  //  Response shape
  // =========================================================================
  it("should return the updated agent with enabled_tools field", async () => {
    agentsService.updateEnabledTools.mockResolvedValueOnce({
      ...existingAgent,
      enabled_tools: ["communicate"],
    });

    const dto = { enabled_tools: ["communicate"] };

    const result = await controller.updateEnabledTools("t1", "agent-123", dto);

    expect(result).toHaveProperty("id", "agent-123");
    expect(result).toHaveProperty("enabled_tools", ["communicate"]);
  });

  // =========================================================================
  //  Error propagation
  // =========================================================================
  it("should propagate NotFoundException when agent does not exist", async () => {
    agentsService.updateEnabledTools.mockRejectedValueOnce(
      new Error("Agent with ID 'missing' not found"),
    );

    const dto = { enabled_tools: ["communicate"] };

    await expect(
      controller.updateEnabledTools("t1", "missing", dto),
    ).rejects.toThrow("not found");
  });

  // =========================================================================
  //  Validation — enabled_tools must be array or null
  // =========================================================================
  it("should reject enabled_tools that is a string", async () => {
    // DTO validation (class-validator) should reject this before hitting service
    const dto = { enabled_tools: "communicate" } as any;

    await expect(
      controller.updateEnabledTools("t1", "agent-123", dto),
    ).rejects.toThrow();
  });

  it("should reject enabled_tools that is a number", async () => {
    const dto = { enabled_tools: 42 } as any;

    await expect(
      controller.updateEnabledTools("t1", "agent-123", dto),
    ).rejects.toThrow();
  });

  // =========================================================================
  //  Tenant isolation
  // =========================================================================
  it("should pass the correct tenant ID to the service", async () => {
    const dto = { enabled_tools: ["communicate"] };

    await controller.updateEnabledTools("tenant-abc", "agent-123", dto);

    expect(agentsService.updateEnabledTools).toHaveBeenCalledWith(
      "tenant-abc",
      "agent-123",
      ["communicate"],
    );
  });
});
