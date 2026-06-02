import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";

type CapturedWorkerOptions = {
  workerOptions?: {
    activityTaskPollerBehavior?: unknown;
    workflowTaskPollerBehavior?: unknown;
    maxConcurrentActivityTaskPolls?: number;
    maxConcurrentWorkflowTaskPolls?: number;
  };
};

const capturedOptions: CapturedWorkerOptions[] = [];

mock.module("../../src/instrumentation", () => ({}));

const realObservability = await import("@yoizen/observability");
mock.module("@yoizen/observability", () => ({
  ...realObservability,
  PinoLoggerService: class {
    log = mock();
    warn = mock();
    error = mock();
    debug = mock();
  },
}));

mock.module("../../src/temporal/temporal-worker-bootstrap", () => ({
  runTemporalWorkerCli: (options: CapturedWorkerOptions) => {
    capturedOptions.push(options);
  },
}));

mock.module("../../src/temporal/activities", () => ({}));

await import("../../src/temporal/worker");

describe("Temporal orchestrator worker config", () => {
  it("uses bounded autoscaling pollers instead of fixed poll counts", () => {
    expect(capturedOptions).toHaveLength(1);
    const workerOptions = capturedOptions[0]?.workerOptions;

    expect(workerOptions?.activityTaskPollerBehavior).toEqual({
      type: "autoscaling",
      minimum: 1,
      initial: 5,
      maximum: 40,
    });
    expect(workerOptions?.workflowTaskPollerBehavior).toEqual({
      type: "autoscaling",
      minimum: 1,
      initial: 5,
      maximum: 20,
    });
    expect(workerOptions?.maxConcurrentActivityTaskPolls).toBeUndefined();
    expect(workerOptions?.maxConcurrentWorkflowTaskPolls).toBeUndefined();
  });
});
