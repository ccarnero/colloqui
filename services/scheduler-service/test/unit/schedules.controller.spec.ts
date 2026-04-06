import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { SchedulesController } from "../../src/modules/schedules/schedules.controller";
import { SchedulesService } from "../../src/modules/schedules/schedules.service";
import { EngineService } from "../../src/engine/engine.service";
import { ScheduleType, ExecMode } from "../../src/modules/schedules/schedules.dto";

const sampleSchedule = {
  id: "s1",
  name: "n",
  description: "",
  type: ScheduleType.CRON,
  expression: "0 * * * *",
  exec_mode: ExecMode.JS_INLINE,
  config: { script: "1+1" },
  enabled: true,
  next_run_at: "2026-01-01T00:00:00.000Z",
  last_run_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("SchedulesController", () => {
  let controller: SchedulesController;
  const findAll = mock(() =>
    Promise.resolve({ schedules: [], limit: 20, offset: 0 }),
  );
  const create = mock(() => Promise.resolve(sampleSchedule));
  const findById = mock(() => Promise.resolve(sampleSchedule));
  const update = mock(() => Promise.resolve(sampleSchedule));
  const remove = mock(() => Promise.resolve());
  const addToQueue = mock();
  const updateInQueue = mock();
  const removeFromQueue = mock();
  const triggerScheduleManually = mock(() => Promise.resolve());

  beforeEach(async () => {
    findAll.mockClear();
    create.mockClear();
    findById.mockClear();
    update.mockClear();
    remove.mockClear();
    addToQueue.mockClear();
    updateInQueue.mockClear();
    removeFromQueue.mockClear();
    triggerScheduleManually.mockClear();

    const module = await Test.createTestingModule({
      controllers: [SchedulesController],
      providers: [
        {
          provide: SchedulesService,
          useValue: { findAll, create, findById, update, remove },
        },
        {
          provide: EngineService,
          useValue: {
            addToQueue,
            updateInQueue,
            removeFromQueue,
            triggerScheduleManually,
          },
        },
      ],
    }).compile();

    controller = module.get(SchedulesController);
  });

  it("findAll delegates to SchedulesService", async () => {
    const r = await controller.findAll("tenant-z", {});
    expect(r.schedules).toEqual([]);
    expect(findAll).toHaveBeenCalled();
  });

  it("create delegates and enqueues when enabled with next_run_at", async () => {
    const dto = {
      name: "n",
      type: ScheduleType.CRON,
      expression: "0 * * * *",
      exec_mode: ExecMode.JS_INLINE,
      config: { script: "return 1" },
    } as never;
    await controller.create("t1", dto);
    expect(create).toHaveBeenCalled();
    expect(addToQueue).toHaveBeenCalled();
  });

  it("findById delegates to SchedulesService", async () => {
    const s = await controller.findById("t1", "s1");
    expect(s.id).toBe("s1");
    expect(findById).toHaveBeenCalledWith("s1", "t1");
  });

  it("update delegates and updates queue", async () => {
    await controller.update("t1", "s1", { name: "x" } as never);
    expect(update).toHaveBeenCalled();
    expect(updateInQueue).toHaveBeenCalled();
  });

  it("remove delegates and removes from queue", async () => {
    await controller.remove("t1", "s1");
    expect(remove).toHaveBeenCalledWith("s1", "t1");
    expect(removeFromQueue).toHaveBeenCalledWith("s1");
  });

  it("trigger executes schedule via engine", async () => {
    const out = await controller.trigger("t1", "s1");
    expect(out.triggered).toBe(true);
    expect(findById).toHaveBeenCalledWith("s1", "t1");
    expect(triggerScheduleManually).toHaveBeenCalledWith("t1", sampleSchedule);
  });
});
