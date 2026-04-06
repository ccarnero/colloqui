import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { AgentsController } = await import(
    "../../src/modules/agents/agents.controller"
  );
  const { AgentsService } = await import(
    "../../src/modules/agents/agents.service"
  );
  return { AgentsController, AgentsService };
};

describe("AgentsController", () => {
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
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: mod.AgentsService, useValue: agentsService }],
    }).compile();
    controller = moduleRef.get(AgentsController);
  });

  it("findAll delegates to AgentsService with query filters", async () => {
    const query = {
      status: "draft",
      is_active: true,
      limit: 10,
      offset: 0,
    };
    const r = await controller.findAll("tenant-x", query as never);
    expect(agentsService.findAll).toHaveBeenCalledWith("tenant-x", {
      status: "draft",
      is_active: true,
      limit: 10,
      offset: 0,
    });
    expect(r.total).toBe(0);
  });

  it("create delegates with DTO fields", async () => {
    await controller.create("t1", {
      name: "N",
      system_prompt: "S",
    } as never);
    expect(agentsService.create).toHaveBeenCalledWith("t1", {
      name: "N",
      description: undefined,
      system_prompt: "S",
      model_config: undefined,
      tools: undefined,
      channels: undefined,
    });
  });

  it("update delegates", async () => {
    await controller.update("t1", "id1", { name: "X" } as never);
    expect(agentsService.update).toHaveBeenCalledWith("t1", "id1", {
      name: "X",
    });
  });

  it("delete delegates", async () => {
    await controller.delete("t1", "id1");
    expect(agentsService.delete).toHaveBeenCalledWith("t1", "id1");
  });

  it("publish and unpublish delegate", async () => {
    await controller.publish("t1", "id1");
    await controller.unpublish("t1", "id1");
    expect(agentsService.publish).toHaveBeenCalledWith("t1", "id1");
    expect(agentsService.unpublish).toHaveBeenCalledWith("t1", "id1");
  });

  it("chat delegates", async () => {
    const dto = { message: "hi" };
    const r = await controller.chat("t1", "a1", dto as never);
    expect(agentsService.chat).toHaveBeenCalledWith("t1", "a1", dto);
    expect(r.reply).toBe("ok");
  });
});
