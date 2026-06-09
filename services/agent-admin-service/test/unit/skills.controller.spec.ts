import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { SkillsController } = await import(
    "../../src/modules/skills/skills.controller"
  );
  const { SkillsService } = await import(
    "../../src/modules/skills/skills.service"
  );
  return { SkillsController, SkillsService };
};

describe("SkillsController", () => {
  let SkillsController: Awaited<ReturnType<typeof load>>["SkillsController"];
  let controller: InstanceType<typeof SkillsController>;
  let skillsService: {
    findAll: ReturnType<typeof mock>;
    findById: ReturnType<typeof mock>;
    create: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
    delete: ReturnType<typeof mock>;
  };

  const mockSkill = {
    id: "s1",
    name: "test-skill",
    description: "A test skill",
    system_prompt: "You are a helpful assistant",
    icon: "smart_toy",
    color: "#42a5f5",
    trigger_commands: ["/hello", "/help"],
    when_to_use: "When user needs help",
    priority: 0,
    allowed_tools: [],
    mode: "llm_driven",
    files: [],
    metadata: {},
    is_active: true,
    created_at: new Date("2025-01-01"),
    updated_at: new Date("2025-01-02"),
  };

  beforeEach(async () => {
    const mod = await load();
    SkillsController = mod.SkillsController;

    skillsService = {
      findAll: mock(() => Promise.resolve({ skills: [mockSkill], total: 1 })),
      findById: mock(() => Promise.resolve(mockSkill)),
      create: mock(() => Promise.resolve({ ...mockSkill, id: "new-id" })),
      update: mock(() => Promise.resolve({ ...mockSkill, name: "updated" })),
      delete: mock(() => Promise.resolve(true)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SkillsController],
      providers: [{ provide: mod.SkillsService, useValue: skillsService }],
    }).compile();

    controller = moduleRef.get(SkillsController);
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  it("findAll delegates to SkillsService and returns skills list", async () => {
    const result = await controller.findAll("tenant-x");

    expect(skillsService.findAll).toHaveBeenCalledWith("tenant-x");
    expect(result).toEqual({ skills: [mockSkill], total: 1 });
  });

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------
  it("findById returns single skill by id", async () => {
    const result = await controller.findById("tenant-x", "s1");

    expect(skillsService.findById).toHaveBeenCalledWith("tenant-x", "s1");
    expect(result).toEqual(mockSkill);
  });

  it("findById returns null when skill not found (pass-through from service)", async () => {
    skillsService.findById = mock(() => Promise.resolve(null));
    const mod = await load();
    const moduleRef = await Test.createTestingModule({
      controllers: [SkillsController],
      providers: [{ provide: mod.SkillsService, useValue: skillsService }],
    }).compile();
    controller = moduleRef.get(SkillsController);

    const result = await controller.findById("tenant-x", "nonexistent");

    expect(skillsService.findById).toHaveBeenCalledWith("tenant-x", "nonexistent");
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  it("create returns created skill with the service result", async () => {
    const dto = {
      name: "new-skill",
      system_prompt: "You are a new assistant",
      description: "A new skill",
    };

    const result = await controller.create("tenant-x", dto as never);

    expect(skillsService.create).toHaveBeenCalledWith("tenant-x", dto);
    expect(result).toEqual({ ...mockSkill, id: "new-id" });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  it("update returns updated skill", async () => {
    const dto = { name: "updated" };

    const result = await controller.update("tenant-x", "s1", dto as never);

    expect(skillsService.update).toHaveBeenCalledWith("tenant-x", "s1", dto);
    expect(result).toEqual({ ...mockSkill, name: "updated" });
  });

  it("update returns null when skill not found (pass-through from service)", async () => {
    skillsService.update = mock(() => Promise.resolve(null));
    const mod = await load();
    const moduleRef = await Test.createTestingModule({
      controllers: [SkillsController],
      providers: [{ provide: mod.SkillsService, useValue: skillsService }],
    }).compile();
    controller = moduleRef.get(SkillsController);

    const result = await controller.update("tenant-x", "nonexistent", { name: "x" } as never);

    expect(skillsService.update).toHaveBeenCalledWith("tenant-x", "nonexistent", { name: "x" });
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  it("delete calls service and returns success", async () => {
    const result = await controller.delete("tenant-x", "s1");

    expect(skillsService.delete).toHaveBeenCalledWith("tenant-x", "s1");
    expect(result).toBe(true);
  });

  it("delete returns false when skill not found (pass-through from service)", async () => {
    skillsService.delete = mock(() => Promise.resolve(false));
    const mod = await load();
    const moduleRef = await Test.createTestingModule({
      controllers: [SkillsController],
      providers: [{ provide: mod.SkillsService, useValue: skillsService }],
    }).compile();
    controller = moduleRef.get(SkillsController);

    const result = await controller.delete("tenant-x", "nonexistent");

    expect(skillsService.delete).toHaveBeenCalledWith("tenant-x", "nonexistent");
    expect(result).toBe(false);
  });
});
