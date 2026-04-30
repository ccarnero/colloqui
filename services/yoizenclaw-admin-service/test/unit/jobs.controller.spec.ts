import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { JobsController } = await import(
    "../../src/modules/jobs/jobs.controller"
  );
  const { JobsService } = await import(
    "../../src/modules/jobs/jobs.service"
  );
  return { JobsController, JobsService };
};

describe("JobsController", () => {
  let JobsController: Awaited<ReturnType<typeof load>>["JobsController"];
  let controller: InstanceType<typeof JobsController>;
  let jobsService: Record<string, ReturnType<typeof mock>>;

  beforeEach(async () => {
    const mod = await load();
    JobsController = mod.JobsController;
    jobsService = {
      findAll: mock(() => Promise.resolve({ jobs: [], total: 0 })),
      findAllExecutions: mock(() =>
        Promise.resolve({ executions: [], total: 0 }),
      ),
      findById: mock(() => Promise.resolve({ id: "j1" })),
      create: mock(() => Promise.resolve({ id: "new" })),
      update: mock(() => Promise.resolve({ id: "j1" })),
      delete: mock(() => Promise.resolve()),
      enable: mock(() => Promise.resolve({ id: "j1" })),
      disable: mock(() => Promise.resolve({ id: "j1" })),
      run: mock(() => Promise.resolve({ id: "ex1" })),
      trigger: mock(() => Promise.resolve({ id: "ex2" })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [{ provide: mod.JobsService, useValue: jobsService }],
    }).compile();
    controller = moduleRef.get(JobsController);
  });

  it("findAll delegates to service with tenant and query", async () => {
    await controller.findAll("t1", {
      agent_id: "a1",
      is_active: true,
      limit: 10,
      offset: 0,
    } as never);
    expect(jobsService.findAll).toHaveBeenCalled();
  });

  it("trigger passes event_payload to service", async () => {
    await controller.trigger("t1", "j1", {
      event_payload: { x: 1 },
    } as never);
    expect(jobsService.trigger).toHaveBeenCalledWith("t1", "j1", { x: 1 });
  });
});
