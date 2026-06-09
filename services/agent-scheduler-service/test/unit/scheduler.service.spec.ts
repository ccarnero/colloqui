// services/agent-scheduler-service/test/unit/scheduler.service.spec.ts
// ── Validation Suite ─────────────────────────────────────────────────────────
// Full validation for SchedulerService: lifecycle management, job scheduling
// (cron/interval), execution flow, and tenant reconciliation.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// ── Module Mocks ───────────────────────────────────────────────────────────
// These must be set up BEFORE importing the service because PinoLoggerService
// and ToadScheduler are used in field initializers.

mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

// Track constructed instances so tests can verify constructor args
const asyncTaskInstances: Array<{ id: string; handler: () => Promise<void> }> = [];
const cronJobInstances: Array<{ config: any; task: any; options: any }> = [];
const intervalJobInstances: Array<{ config: any; task: any; options: any }> = [];

mock.module("toad-scheduler", () => ({
  ToadScheduler: class MockToadScheduler {
    addSimpleIntervalJob = mock(() => {});
    addCronJob = mock(() => {});
    removeById = mock(() => {});
    stop = mock(() => {});
  },
  AsyncTask: class MockAsyncTask {
    constructor(public id: string, public handler: () => Promise<void>) {
      asyncTaskInstances.push({ id, handler });
    }
  },
  SimpleIntervalJob: class MockSimpleIntervalJob {
    constructor(config: any, task: any, options: any) {
      intervalJobInstances.push({ config, task, options });
    }
  },
  CronJob: class MockCronJob {
    constructor(config: any, task: any, options: any) {
      cronJobInstances.push({ config, task, options });
    }
  },
}));

import type { JobDefinition } from "../../src/abstractions/job-definition.interface";
import { SchedulerService } from "../../src/modules/scheduler/scheduler.service";
import { agentSchedulerServiceConfig } from "../../src/config";

// ── Fixtures ───────────────────────────────────────────────────────────────

const CRON_JOB: JobDefinition = {
  id: "job-cron-1",
  name: "Daily Report",
  agent_id: "agent-1",
  schedule: "0 6 * * *",
  schedule_type: "cron",
  payload: { type: "report" },
  is_active: true,
  last_run: null,
  next_run: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const INTERVAL_JOB: JobDefinition = {
  id: "job-int-1",
  name: "Health Check",
  agent_id: "agent-2",
  schedule: "300",
  schedule_type: "interval",
  payload: { endpoint: "/health" },
  is_active: true,
  last_run: null,
  next_run: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const ANOTHER_JOB: JobDefinition = {
  id: "job-cron-2",
  name: "Weekly Summary",
  agent_id: "agent-1",
  schedule: "0 0 * * 0",
  schedule_type: "cron",
  payload: { type: "summary" },
  is_active: true,
  last_run: null,
  next_run: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

function buildMockJob(
  overrides: Partial<JobDefinition> = {},
): JobDefinition {
  return { ...CRON_JOB, ...overrides };
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe("SchedulerService", () => {
  let service: SchedulerService;
  let mockTenantManager: { getKnownTenantIds: ReturnType<typeof mock> };
  let mockJobReader: { readAllTenantJobs: ReturnType<typeof mock> };
  let mockJobTrigger: { publishTrigger: ReturnType<typeof mock> };
  let mockLeaderElection: {
    tryAcquireLeadership: ReturnType<typeof mock>;
    isCurrentlyLeader: ReturnType<typeof mock>;
    release: ReturnType<typeof mock>;
    onModuleDestroy: ReturnType<typeof mock>;
  };
  let mockExecutionHistory: {
    recordExecution: ReturnType<typeof mock>;
    getRecentExecutions: ReturnType<typeof mock>;
  };
  let originalSetInterval: typeof globalThis.setInterval;
  let originalSetTimeout: typeof globalThis.setTimeout;
  let capturedIntervals: Array<{ fn: () => void; ms: number }>;
  let capturedTimeouts: Array<{ fn: () => void; ms: number }>;

  beforeEach(() => {
    // Clear tracked instances from mock module-level arrays
    asyncTaskInstances.length = 0;
    cronJobInstances.length = 0;
    intervalJobInstances.length = 0;

    // Capture setInterval so tests control timing
    capturedIntervals = [];
    originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((fn: (...args: unknown[]) => void, ms: number) => {
      const wrapped = { fn: fn as () => void, ms };
      capturedIntervals.push(wrapped);
      return wrapped as unknown as ReturnType<typeof setInterval>;
    }) as typeof globalThis.setInterval;

    // Capture setTimeout so tests control timing
    capturedTimeouts = [];
    originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms: number) => {
      const wrapped = { fn: fn as () => void, ms };
      capturedTimeouts.push(wrapped);
      return wrapped as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;

    mockTenantManager = {
      getKnownTenantIds: mock(() => ["tenant-1", "tenant-2"]),
    };

    mockJobReader = {
      readAllTenantJobs: mock(() => Promise.resolve(new Map())),
    };

    mockJobTrigger = {
      publishTrigger: mock(() => Promise.resolve("execution-uuid")),
    };

    mockLeaderElection = {
      tryAcquireLeadership: mock(() => Promise.resolve(true)),
      isCurrentlyLeader: mock(() => true),
      release: mock(() => Promise.resolve()),
      onModuleDestroy: mock(() => Promise.resolve()),
    };

    mockExecutionHistory = {
      recordExecution: mock(() => Promise.resolve()),
      getRecentExecutions: mock(() => Promise.resolve([])),
    };

    service = new SchedulerService(
      mockTenantManager as any,
      mockJobReader as any,
      mockJobTrigger as any,
      mockLeaderElection as any,
      mockExecutionHistory as any,
    );
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.setTimeout = originalSetTimeout;

    // Clean up any intervals left on the service
    if ((service as any).reconcileInterval) {
      clearInterval((service as any).reconcileInterval);
    }
    if ((service as any).leaderRetryInterval) {
      clearInterval((service as any).leaderRetryInterval);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  start / stop lifecycle
  // ════════════════════════════════════════════════════════════════════════

  describe("start / stop lifecycle", () => {
    it("should acquire leadership and start the scheduler when start() is called", async () => {
      await service.start();

      expect(mockLeaderElection.tryAcquireLeadership).toHaveBeenCalledTimes(1);
      // Should have called reconcileAllTenants as part of startScheduler
      expect(mockJobReader.readAllTenantJobs).toHaveBeenCalled();
      // Should have set up reconcile interval
      expect((service as any).reconcileInterval).not.toBeNull();
    });

    it("should start the retry loop when leader election returns false", async () => {
      mockLeaderElection.tryAcquireLeadership.mockImplementation(() =>
        Promise.resolve(false),
      );

      await service.start();

      expect(mockLeaderElection.tryAcquireLeadership).toHaveBeenCalledTimes(1);
      // Should NOT have started reconciling
      expect(mockJobReader.readAllTenantJobs).not.toHaveBeenCalled();
      // Should have started retry loop
      expect((service as any).leaderRetryInterval).not.toBeNull();
    });

    it("should stop the scheduler and clear intervals on onModuleDestroy", async () => {
      const mockScheduler = (service as any).scheduler;

      await service.start();
      expect((service as any).reconcileInterval).not.toBeNull();

      await service.onModuleDestroy();

      expect(mockScheduler.stop).toHaveBeenCalled();
      expect((service as any).reconcileInterval).toBeNull();
      expect((service as any).leaderRetryInterval).toBeNull();
    });

    it("should be idempotent when onModuleDestroy is called without prior start", async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  addSchedule (private — invoked via (service as any))
  // ════════════════════════════════════════════════════════════════════════

  describe("addSchedule", () => {
    it("should create a CronJob and add it to the scheduler for cron-type jobs", () => {
      (service as any).addSchedule("tenant-1", CRON_JOB);

      const scheduler = (service as any).scheduler;
      expect(scheduler.addCronJob).toHaveBeenCalledTimes(1);
      expect(scheduler.addSimpleIntervalJob).not.toHaveBeenCalled();

      // Verify the CronJob was created with the right options
      expect(cronJobInstances).toHaveLength(1);
      expect(cronJobInstances[0].config.cronExpression).toBe("0 6 * * *");
      expect(cronJobInstances[0].options.id).toBe("tenant-1:job-cron-1");

      // Verify the AsyncTask was created with the composite ID
      expect(asyncTaskInstances).toHaveLength(1);
      expect(asyncTaskInstances[0].id).toBe("tenant-1:job-cron-1");
    });

    it("should create a SimpleIntervalJob and add it to the scheduler for interval-type jobs", () => {
      (service as any).addSchedule("tenant-1", INTERVAL_JOB);

      const scheduler = (service as any).scheduler;
      expect(scheduler.addSimpleIntervalJob).toHaveBeenCalledTimes(1);
      expect(scheduler.addCronJob).not.toHaveBeenCalled();

      // Verify the interval job was created with the correct milliseconds
      expect(intervalJobInstances).toHaveLength(1);
      expect(intervalJobInstances[0].config.milliseconds).toBe(300_000);
      expect(intervalJobInstances[0].options.id).toBe("tenant-1:job-int-1");
    });

    it("should use composite tenant:job ID for the AsyncTask and scheduler options", () => {
      (service as any).addSchedule("tenant-alpha", CRON_JOB);

      expect(asyncTaskInstances[0].id).toBe("tenant-alpha:job-cron-1");
      expect(cronJobInstances[0].options.id).toBe("tenant-alpha:job-cron-1");
    });

    it("should create a handler that calls executeJob (proved by calling the captured handler)", async () => {
      (service as any).addSchedule("tenant-1", CRON_JOB);

      // The captured handler should call executeJob internally
      expect(asyncTaskInstances).toHaveLength(1);
      const handler = asyncTaskInstances[0].handler;

      // Execute the handler — it will try to call executeJob which depends on
      // the mocked jobTrigger and executionHistory
      await handler();

      // The handler triggers executeJob, which calls publishTrigger
      expect(mockJobTrigger.publishTrigger).toHaveBeenCalledWith(
        "tenant-1",
        CRON_JOB.id,
        CRON_JOB.payload,
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  removeSchedule (private — invoked via (service as any))
  // ════════════════════════════════════════════════════════════════════════

  describe("removeSchedule", () => {
    it("should call scheduler.removeById with the composite ID", () => {
      const scheduler = (service as any).scheduler;

      (service as any).removeSchedule("tenant-1", "job-cron-1", {
        type: "cron",
        schedule: "0 6 * * *",
      });

      expect(scheduler.removeById).toHaveBeenCalledWith("tenant-1:job-cron-1");
    });

    it("should handle removal of both cron and interval schedules identically", () => {
      const scheduler = (service as any).scheduler;

      (service as any).removeSchedule("tenant-1", "job-int-1", {
        type: "interval",
        schedule: "300",
      });

      expect(scheduler.removeById).toHaveBeenCalledWith("tenant-1:job-int-1");
    });

    it("should not throw when removing a non-existent job", () => {
      const scheduler = (service as any).scheduler;
      scheduler.removeById = mock(() => {
        throw new Error("Not found");
      });

      expect(() =>
        (service as any).removeSchedule("tenant-1", "ghost-job", {
          type: "cron",
          schedule: "* * * * *",
        }),
      ).not.toThrow();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  executeJob (private — invoked via (service as any))
  // ════════════════════════════════════════════════════════════════════════

  describe("executeJob", () => {
    it("should publish the trigger and record as 'published' on success", async () => {
      mockJobTrigger.publishTrigger.mockImplementation(() =>
        Promise.resolve("exec-123"),
      );

      await (service as any).executeJob("tenant-1", CRON_JOB);

      expect(mockJobTrigger.publishTrigger).toHaveBeenCalledWith(
        "tenant-1",
        CRON_JOB.id,
        CRON_JOB.payload,
      );

      expect(mockExecutionHistory.recordExecution).toHaveBeenCalledTimes(1);
      const record = mockExecutionHistory.recordExecution.mock
        .calls[0][0] as any;

      expect(record.tenantId).toBe("tenant-1");
      expect(record.jobId).toBe(CRON_JOB.id);
      expect(record.executionId).toBe("exec-123");
      expect(record.status).toBe("published");
      expect(record).toHaveProperty("triggeredAt");
    });

    it("should record as 'failed' when publishTrigger throws", async () => {
      mockJobTrigger.publishTrigger.mockImplementation(() =>
        Promise.reject(new Error("NATS unavailable")),
      );

      await (service as any).executeJob("tenant-1", CRON_JOB);

      // Should still record execution, but with failed status
      expect(mockExecutionHistory.recordExecution).toHaveBeenCalledTimes(1);
      const record = mockExecutionHistory.recordExecution.mock
        .calls[0][0] as any;

      expect(record.tenantId).toBe("tenant-1");
      expect(record.jobId).toBe(CRON_JOB.id);
      expect(record.executionId).toBe("");
      expect(record.status).toBe("failed");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  getActiveSchedulesSummary / getActiveScheduleCount
  // ════════════════════════════════════════════════════════════════════════

  describe("getActiveSchedulesSummary", () => {
    it("should return an empty array when no schedules are active", () => {
      const summary = service.getActiveSchedulesSummary();
      expect(summary).toEqual([]);
    });

    it("should return the correct tenant summaries with job counts", () => {
      const activeSchedules = (service as any).activeSchedules;
      activeSchedules.set("tenant-1", new Map([["job-1", CRON_JOB]]));
      activeSchedules.set(
        "tenant-2",
        new Map([
          ["job-2", INTERVAL_JOB],
          ["job-3", ANOTHER_JOB],
        ]),
      );

      const summary = service.getActiveSchedulesSummary();

      expect(summary).toHaveLength(2);
      expect(summary).toContainEqual({ tenantId: "tenant-1", jobCount: 1 });
      expect(summary).toContainEqual({ tenantId: "tenant-2", jobCount: 2 });
    });
  });

  describe("getActiveScheduleCount", () => {
    it("should return 0 when no schedules are active", () => {
      expect(service.getActiveScheduleCount()).toBe(0);
    });

    it("should return the total number of active schedules across all tenants", () => {
      const activeSchedules = (service as any).activeSchedules;
      activeSchedules.set("tenant-1", new Map([["job-1", CRON_JOB]]));
      activeSchedules.set(
        "tenant-2",
        new Map([
          ["job-2", INTERVAL_JOB],
          ["job-3", ANOTHER_JOB],
        ]),
      );

      expect(service.getActiveScheduleCount()).toBe(3);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  reconcileAllTenants — diff logic
  // ════════════════════════════════════════════════════════════════════════

  describe("reconcileAllTenants", () => {
    it("should return early without doing anything when not the leader", async () => {
      mockLeaderElection.isCurrentlyLeader.mockImplementation(() => false);

      await service.reconcileAllTenants();

      expect(mockJobReader.readAllTenantJobs).not.toHaveBeenCalled();
    });

    it("should add new jobs from the reader that are not yet active", async () => {
      const scheduler = (service as any).scheduler;

      mockJobReader.readAllTenantJobs.mockImplementation(() =>
        Promise.resolve(new Map([["tenant-1", [CRON_JOB]]])),
      );

      await service.reconcileAllTenants();

      // Should have added the cron job
      expect(scheduler.addCronJob).toHaveBeenCalledTimes(1);
      expect(cronJobInstances[0].options.id).toBe("tenant-1:job-cron-1");

      // Should show 1 active schedule
      const summary = service.getActiveSchedulesSummary();
      expect(summary).toContainEqual({ tenantId: "tenant-1", jobCount: 1 });
    });

    it("should remove jobs for tenants that no longer exist in the reader", async () => {
      const scheduler = (service as any).scheduler;
      const activeSchedules = (service as any).activeSchedules;

      // Pre-populate existing active schedules for two tenants
      const tenant1Jobs = new Map([["job-1", { type: "cron", schedule: "0 6 * * *" }]]);
      const tenant2Jobs = new Map([["job-2", { type: "interval", schedule: "300" }]]);
      activeSchedules.set("tenant-1", tenant1Jobs);
      activeSchedules.set("tenant-2", tenant2Jobs);

      // Reader returns only tenant-1 — tenant-2 should be removed
      mockJobReader.readAllTenantJobs.mockImplementation(() =>
        Promise.resolve(new Map([["tenant-1", [CRON_JOB]]])),
      );

      await service.reconcileAllTenants();

      // tenant-2's job should have been removed
      expect(scheduler.removeById).toHaveBeenCalledWith("tenant-2:job-2");
      // tenant-2 should be gone from active schedules
      expect(activeSchedules.has("tenant-2")).toBe(false);
      expect(activeSchedules.has("tenant-1")).toBe(true);
    });

    it("should update a job when its schedule changes", async () => {
      const scheduler = (service as any).scheduler;
      const activeSchedules = (service as any).activeSchedules;

      // Existing schedule has old cron expression
      const existingMap = new Map([
        ["job-cron-1", { type: "cron", schedule: "0 0 * * *" }], // different from CRON_JOB.schedule
      ]);
      activeSchedules.set("tenant-1", existingMap);

      // Reader returns the job with a new schedule
      mockJobReader.readAllTenantJobs.mockImplementation(() =>
        Promise.resolve(new Map([["tenant-1", [CRON_JOB]]])),
      );

      await service.reconcileAllTenants();

      // Should have removed the old schedule
      expect(scheduler.removeById).toHaveBeenCalledWith("tenant-1:job-cron-1");
      // Should have added the new one
      expect(scheduler.addCronJob).toHaveBeenCalled();
    });

    it("should do nothing when existing schedules match the reader exactly", async () => {
      const scheduler = (service as any).scheduler;
      const activeSchedules = (service as any).activeSchedules;

      // Existing schedule matches reader
      const existingMap = new Map([
        ["job-cron-1", { type: "cron", schedule: "0 6 * * *" }],
      ]);
      activeSchedules.set("tenant-1", existingMap);

      mockJobReader.readAllTenantJobs.mockImplementation(() =>
        Promise.resolve(new Map([["tenant-1", [CRON_JOB]]])),
      );

      await service.reconcileAllTenants();

      // No adds, removes, or updates
      expect(scheduler.addCronJob).not.toHaveBeenCalled();
      expect(scheduler.addSimpleIntervalJob).not.toHaveBeenCalled();
      expect(scheduler.removeById).not.toHaveBeenCalled();
    });

    it("should handle reconciliation errors gracefully without throwing", async () => {
      mockJobReader.readAllTenantJobs.mockImplementation(() =>
        Promise.reject(new Error("DB unavailable")),
      );

      // Should not throw
      await expect(service.reconcileAllTenants()).resolves.toBeUndefined();
    });
  });
});
