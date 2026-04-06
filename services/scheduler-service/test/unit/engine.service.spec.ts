import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { EngineService } from "../../src/engine/engine.service";
import { ScheduleQueue } from "../../src/engine/schedule-queue";
import {
  SchedulesService,
  type ISchedule,
} from "../../src/modules/schedules/schedules.service";
import { ExecutionsService } from "../../src/modules/executions/executions.service";
import { TenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  ScheduleType,
  ExecMode,
} from "../../src/modules/schedules/schedules.dto";
import type { IScheduleExecutor } from "../../src/executors/executor.interface";

function sampleSchedule(overrides: Partial<ISchedule> = {}): ISchedule {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "job",
    description: "",
    type: ScheduleType.CRON,
    expression: "0 0 * * *",
    exec_mode: ExecMode.JS_INLINE,
    config: { script: "return 1" },
    enabled: true,
    next_run_at: "2020-01-02T00:00:00.000Z",
    last_run_at: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("EngineService", () => {
  let engine: EngineService;
  let schedulesService: {
    claimSchedule: ReturnType<typeof mock>;
    markExecuted: ReturnType<typeof mock>;
    getEnabledSchedules: ReturnType<typeof mock>;
  };
  let executionsService: {
    createLog: ReturnType<typeof mock>;
    updateStatus: ReturnType<typeof mock>;
  };
  let tenantConnections: {
    getKnownTenantIds: ReturnType<typeof mock>;
  };

  function getQueue(): ScheduleQueue {
    return (engine as unknown as { queue: ScheduleQueue }).queue;
  }

  function getTick(): () => Promise<void> {
    return (engine as unknown as { tick: () => Promise<void> }).tick.bind(
      engine,
    );
  }

  beforeEach(async () => {
    schedulesService = {
      claimSchedule: mock(() => Promise.resolve(null)),
      markExecuted: mock(() => Promise.resolve(null)),
      getEnabledSchedules: mock(() => Promise.resolve([])),
    };
    executionsService = {
      createLog: mock(() =>
        Promise.resolve({
          id: "log-1",
          schedule_id: "550e8400-e29b-41d4-a716-446655440000",
          status: "pending",
          started_at: "2020-01-01T00:00:00.000Z",
          completed_at: null,
          duration_ms: null,
          output: "",
          error: "",
          metadata: {},
          created_at: "2020-01-01T00:00:00.000Z",
        }),
      ),
      updateStatus: mock(() => Promise.resolve({})),
    };
    tenantConnections = {
      getKnownTenantIds: mock(() => []),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EngineService,
        { provide: SchedulesService, useValue: schedulesService },
        { provide: ExecutionsService, useValue: executionsService },
        { provide: TenantConnectionManager, useValue: tenantConnections },
      ],
    }).compile();

    engine = moduleRef.get(EngineService);
  });

  describe("queue helpers", () => {
    it("addToQueue skips when next_run_at is missing", () => {
      engine.addToQueue("tenant-a", sampleSchedule({ next_run_at: null }));
      expect(getQueue().size).toBe(0);
    });

    it("addToQueue inserts by next_run_at", () => {
      engine.addToQueue("tenant-a", sampleSchedule());
      expect(getQueue().size).toBe(1);
      expect(getQueue().pop()?.scheduleId).toBe(
        "550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it("removeFromQueue removes by schedule id", () => {
      engine.addToQueue("tenant-a", sampleSchedule());
      engine.removeFromQueue("550e8400-e29b-41d4-a716-446655440000");
      expect(getQueue().size).toBe(0);
    });

    it("updateInQueue removes when disabled or missing next_run_at", () => {
      engine.addToQueue("tenant-a", sampleSchedule());
      engine.updateInQueue(
        "tenant-a",
        sampleSchedule({
          enabled: false,
          next_run_at: "2020-01-02T00:00:00.000Z",
        }),
      );
      expect(getQueue().size).toBe(0);

      engine.addToQueue("tenant-a", sampleSchedule());
      engine.updateInQueue("tenant-a", sampleSchedule({ next_run_at: null }));
      expect(getQueue().size).toBe(0);
    });

    it("updateInQueue re-inserts when enabled with next_run_at", () => {
      engine.updateInQueue("tenant-a", sampleSchedule());
      expect(getQueue().size).toBe(1);
    });
  });

  describe("executeSchedule", () => {
    it("does nothing when no executor is registered", async () => {
      await engine.executeSchedule("tenant-a", sampleSchedule());
      expect(executionsService.createLog).not.toHaveBeenCalled();
    });

    it("dispatches to the executor for exec_mode and updates execution log", async () => {
      const executeMock = mock(() =>
        Promise.resolve({
          status: "completed",
          output: "ok",
          error: "",
          metadata: { k: 1 },
        }),
      );
      const executor: IScheduleExecutor = { execute: executeMock };
      engine.registerExecutor(ExecMode.JS_INLINE, executor);

      await engine.executeSchedule("tenant-a", sampleSchedule());

      expect(executionsService.createLog).toHaveBeenCalled();
      expect(executionsService.updateStatus).toHaveBeenCalled();
      const calls = executionsService.updateStatus.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it("records failed status when executor throws", async () => {
      const executor: IScheduleExecutor = {
        execute: mock(() => Promise.reject(new Error("boom"))),
      };
      engine.registerExecutor(ExecMode.JS_INLINE, executor);

      await engine.executeSchedule("tenant-a", sampleSchedule());

      const lastCall =
        executionsService.updateStatus.mock.calls[
          executionsService.updateStatus.mock.calls.length - 1
        ];
      const opts = lastCall?.[0] as { status: string; error?: string };
      expect(opts?.status).toBe("failed");
      expect(opts?.error).toBe("boom");
    });
  });

  describe("tick loop", () => {
    it("runs due entries through claim -> execute -> markExecuted", async () => {
      const sched = sampleSchedule({
        next_run_at: "2000-01-01T00:00:00.000Z",
      });
      const executeMock = mock(() =>
        Promise.resolve({
          status: "completed",
          output: "",
          error: "",
          metadata: {},
        }),
      );
      const executor: IScheduleExecutor = { execute: executeMock };
      engine.registerExecutor(ExecMode.JS_INLINE, executor);
      engine.addToQueue("tenant-a", sched);

      schedulesService.claimSchedule.mockImplementationOnce(() =>
        Promise.resolve(sched),
      );
      schedulesService.markExecuted.mockImplementationOnce(() =>
        Promise.resolve({ ...sched, enabled: false, next_run_at: null }),
      );

      await getTick()();

      expect(schedulesService.claimSchedule).toHaveBeenCalledWith(
        sched.id,
        "tenant-a",
      );
      expect(schedulesService.markExecuted).toHaveBeenCalledWith(
        sched.id,
        "tenant-a",
      );
      expect(executeMock).toHaveBeenCalled();
    });

    it("skips processing when claim returns null", async () => {
      const sched = sampleSchedule({
        next_run_at: "2000-01-01T00:00:00.000Z",
      });
      engine.addToQueue("tenant-a", sched);
      schedulesService.claimSchedule.mockImplementationOnce(() =>
        Promise.resolve(null),
      );

      await getTick()();

      expect(executionsService.createLog).not.toHaveBeenCalled();
    });
  });

  describe("onModuleInit interval wiring", () => {
    it("registers tick and discovery intervals", async () => {
      const origSetInterval = global.setInterval;
      const origClearInterval = global.clearInterval;
      const tickCallbacks: Array<() => void> = [];

      try {
        global.setInterval = ((fn: TimerHandler) => {
          if (typeof fn === "function") tickCallbacks.push(fn as () => void);
          return 999 as unknown as ReturnType<typeof setInterval>;
        }) as typeof setInterval;

        await engine.onModuleInit();

        expect(tickCallbacks.length).toBe(2);
        schedulesService.claimSchedule.mockImplementationOnce(() =>
          Promise.resolve(null),
        );
        await tickCallbacks[0]?.();
      } finally {
        global.setInterval = origSetInterval;
        global.clearInterval = origClearInterval;
        engine.onModuleDestroy();
      }
    });
  });
});
