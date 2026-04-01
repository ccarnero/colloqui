import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { V1Job } from "@kubernetes/client-node";
import { K8sJobExecutor } from "../../src/executors/k8s-job.executor";
import {
  K8S_BATCH_API,
  K8S_CORE_API,
} from "../../src/providers/k8s-api.tokens";
import { Test } from "@nestjs/testing";
import {
  ExecMode,
  ScheduleType,
} from "../../src/modules/schedules/schedule.dto";
import type { Schedule } from "../../src/modules/schedules/schedules.service";

function baseSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "k8s-job",
    description: "",
    type: ScheduleType.CRON,
    expression: "0 0 * * *",
    exec_mode: ExecMode.JS_K8S,
    config: {
      script: "console.log('ok');",
      timeout: 120,
    },
    enabled: true,
    next_run_at: "2020-01-02T00:00:00.000Z",
    last_run_at: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("K8sJobExecutor", () => {
  let batchApi: {
    createNamespacedJob: ReturnType<typeof mock>;
    readNamespacedJob: ReturnType<typeof mock>;
    deleteNamespacedJob: ReturnType<typeof mock>;
  };
  let coreApi: {
    createNamespacedConfigMap: ReturnType<typeof mock>;
    listNamespacedPod: ReturnType<typeof mock>;
    readNamespacedPodLog: ReturnType<typeof mock>;
    deleteNamespacedConfigMap: ReturnType<typeof mock>;
  };
  let executor: K8sJobExecutor;

  beforeEach(async () => {
    batchApi = {
      createNamespacedJob: mock(() => Promise.resolve({})),
      readNamespacedJob: mock(() =>
        Promise.resolve({
          status: {
            conditions: [{ type: "Complete", status: "True" }],
          },
        }),
      ),
      deleteNamespacedJob: mock(() => Promise.resolve({})),
    };
    coreApi = {
      createNamespacedConfigMap: mock(() => Promise.resolve({})),
      listNamespacedPod: mock(() =>
        Promise.resolve({
          items: [{ metadata: { name: "task-pod-1" } }],
        }),
      ),
      readNamespacedPodLog: mock(() => Promise.resolve("log line")),
      deleteNamespacedConfigMap: mock(() => Promise.resolve({})),
    };

    const module = await Test.createTestingModule({
      providers: [
        K8sJobExecutor,
        { provide: K8S_CORE_API, useValue: coreApi },
        { provide: K8S_BATCH_API, useValue: batchApi },
      ],
    }).compile();

    executor = module.get(K8sJobExecutor);
  });

  it("creates a Kubernetes Job with expected namespace and labels", async () => {
    const schedule = baseSchedule();
    await executor.execute(schedule, "tenant-a");

    expect(batchApi.createNamespacedJob).toHaveBeenCalled();
    const call = batchApi.createNamespacedJob.mock.calls[0]?.[0] as {
      namespace: string;
      body: V1Job;
    };
    expect(call?.namespace).toBe("tenant-a-dev-ns");
    expect(call?.body.metadata?.labels?.["yoizen.io/managed-by"]).toBe(
      "scheduler-service",
    );
    expect(call?.body.metadata?.labels?.["yoizen.io/schedule-id"]).toBe(
      schedule.id,
    );
    expect(call?.body.spec?.template?.spec?.containers?.[0]?.name).toBe(
      "task",
    );
  });

  it("creates a ConfigMap with the script for js-k8s mode", async () => {
    await executor.execute(baseSchedule(), "tenant-b");

    expect(coreApi.createNamespacedConfigMap).toHaveBeenCalled();
    const cmCall = coreApi.createNamespacedConfigMap.mock.calls[0]?.[0] as {
      namespace: string;
      body: { data?: Record<string, string> };
    };
    expect(cmCall?.namespace).toBe("tenant-b-dev-ns");
    expect(cmCall?.body.data?.["script.js"]).toContain("console.log");
  });

  it("does not create a ConfigMap for docker exec mode", async () => {
    await executor.execute(
      baseSchedule({
        exec_mode: ExecMode.DOCKER,
        config: {
          image: "alpine:3.20",
          timeout: 60,
        },
      }),
      "tenant-c",
    );

    expect(coreApi.createNamespacedConfigMap).not.toHaveBeenCalled();
    const jobCall = batchApi.createNamespacedJob.mock.calls[0]?.[0] as {
      body: V1Job;
    };
    expect(jobCall?.body.spec?.template?.spec?.containers?.[0]?.image).toBe(
      "alpine:3.20",
    );
  });

  it("returns completed status and pod logs on job success", async () => {
    const result = await executor.execute(baseSchedule(), "tenant-d");

    expect(result.status).toBe("completed");
    expect(result.output).toBe("log line");
    expect(result.error).toBe("");
    expect(result.metadata?.tenantId).toBe("tenant-d");
    expect(result.metadata?.execMode).toBe(ExecMode.JS_K8S);
  });

  it("returns failed status when the Job reports Failed", async () => {
    batchApi.readNamespacedJob = mock(() =>
      Promise.resolve({
        status: {
          conditions: [{ type: "Failed", status: "True", reason: "BackoffLimitExceeded" }],
        },
      }),
    );

    const result = await executor.execute(baseSchedule(), "tenant-e");

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Job failed");
    expect(coreApi.readNamespacedPodLog).toHaveBeenCalled();
  });

  it("returns timeout status when the Job fails with DeadlineExceeded", async () => {
    batchApi.readNamespacedJob = mock(() =>
      Promise.resolve({
        status: {
          conditions: [
            { type: "Failed", status: "True", reason: "DeadlineExceeded" },
          ],
        },
      }),
    );

    const result = await executor.execute(baseSchedule(), "tenant-f");

    expect(result.status).toBe("timeout");
    expect(result.error).toBe("");
  });

  it("returns failed with API error message when createNamespacedJob throws", async () => {
    batchApi.createNamespacedJob = mock(() =>
      Promise.reject(new Error("admission denied")),
    );

    const result = await executor.execute(baseSchedule(), "tenant-g");

    expect(result.status).toBe("failed");
    expect(result.error).toContain("admission denied");
  });

  describe("cleanup", () => {
    it("deletes the Job and ConfigMap after execution", async () => {
      await executor.execute(baseSchedule(), "tenant-h");

      expect(batchApi.deleteNamespacedJob).toHaveBeenCalled();
      const delJob = batchApi.deleteNamespacedJob.mock.calls[0]?.[0] as {
        name: string;
        namespace: string;
      };
      expect(delJob?.namespace).toBe("tenant-h-dev-ns");
      expect(delJob?.name).toMatch(/^sched-550e8400-/);

      expect(coreApi.deleteNamespacedConfigMap).toHaveBeenCalled();
      const delCm = coreApi.deleteNamespacedConfigMap.mock.calls[0]?.[0] as {
        name: string;
        namespace: string;
      };
      expect(delCm?.namespace).toBe("tenant-h-dev-ns");
      expect(delCm?.name).toMatch(/^sched-550e8400-.*-script$/);
    });

    it("still attempts cleanup when job creation fails", async () => {
      batchApi.createNamespacedJob = mock(() =>
        Promise.reject(new Error("rbac")),
      );

      await executor.execute(baseSchedule(), "tenant-i");

      expect(batchApi.deleteNamespacedJob).toHaveBeenCalled();
      expect(coreApi.deleteNamespacedConfigMap).toHaveBeenCalled();
    });

    it("ignores delete errors from TTL or missing resources", async () => {
      batchApi.deleteNamespacedJob = mock(() =>
        Promise.reject(new Error("not found")),
      );
      coreApi.deleteNamespacedConfigMap = mock(() =>
        Promise.reject(new Error("gone")),
      );

      const result = await executor.execute(baseSchedule(), "tenant-j");

      expect(result.status).toBe("completed");
    });
  });

  describe("polling until completion", () => {
    it("waits until the Job reports Complete", async () => {
      let reads = 0;
      batchApi.readNamespacedJob = mock(() => {
        reads += 1;
        if (reads < 3) {
          return Promise.resolve({ status: { conditions: [] } });
        }
        return Promise.resolve({
          status: {
            conditions: [{ type: "Complete", status: "True" }],
          },
        });
      });

      const orig = global.setTimeout;
      global.setTimeout = ((cb: TimerHandler, _ms?: number, ...args: unknown[]) =>
        orig(cb, 0, ...args)) as typeof setTimeout;

      try {
        const result = await executor.execute(baseSchedule(), "tenant-k");
        expect(result.status).toBe("completed");
        expect(reads).toBe(3);
      } finally {
        global.setTimeout = orig;
      }
    });
  });
});
