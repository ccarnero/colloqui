import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";

const executeAndWaitMock = mock(() =>
  Promise.resolve({
    executionId: "exec-1",
    tenantId: "tenant-a",
    type: "chat",
    state: "completed",
    requestedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    agentId: "agent-uuid-1",
    result: { reply: "hello", tool_calls: [] },
  }),
);

/**
 * Controls what `Context.current()` returns inside the activity body
 * under test. `null` simulates "called outside an activity context"
 * which is the default for unit tests (legacy random-UUID fallback);
 * an object simulates a real Temporal activity invocation so we can
 * assert the stable `runId:activityId` executionId is forwarded —
 * post-mortem §P1.3 fix 2.
 */
let mockActivityContext:
  | {
      info: {
        workflowExecution: { runId: string; workflowId: string };
        activityId: string;
      };
    }
  | null = null;

mock.module("@temporalio/activity", () => ({
  ApplicationFailure: {
    nonRetryable: (message: string, type: string, details?: unknown) => {
      const err = new Error(message) as Error & {
        type?: string;
        details?: unknown;
        nonRetryable?: boolean;
      };
      err.type = type;
      err.details = details;
      err.nonRetryable = true;
      return err;
    },
  },
  Context: {
    current: () => {
      if (mockActivityContext === null) {
        throw new Error("not inside an activity context");
      }
      return mockActivityContext;
    },
  },
}));

const mockRedisInstance = {
  script: mock(() => Promise.resolve("sha-fake")),
  evalsha: mock(() => Promise.resolve(["allow", "closed", ""])),
  eval: mock(() => Promise.resolve(["allow", "closed", ""])),
  get: mock(() => Promise.resolve(null)),
  setex: mock(() => Promise.resolve("OK")),
  del: mock(() => Promise.resolve(1)),
  options: {},
  status: "ready",
};

mock.module("@yoizen/database", () => {
  return {
    createRedisClient: () => mockRedisInstance,
  };
});

mock.module("nats", () => {
  const nc = {
    isClosed: () => false,
    jetstream: () => ({ publish: mock(() => Promise.resolve()) }),
    subscribe: mock(() => ({ unsubscribe() {} })),
  };

  return {
    connect: mock(() => Promise.resolve(nc)),
  };
});

mock.module("@yoizen/shared", async () => {
  class FakeExecutionClient {
    async executeAndWait(...args: unknown[]) {
      return executeAndWaitMock(...args);
    }
  }

  return {
    DistributedCircuitBreaker: class DistributedCircuitBreaker {
      scriptLoad() {
        return Promise.resolve();
      }
      canProceed() {
        return Promise.resolve({ action: "allow", status: "closed", reason: "" });
      }
      recordSuccess() {}
      recordFailure() {}
    },
    YoizenClawExecutionClient: FakeExecutionClient,
    computeBreakerKey: ({ tenantId, agentId }: { tenantId: string; agentId: string }) =>
      `${tenantId}:${agentId}`,
  };
});

mock.module("@yoizen/observability", () => {
  class FakeLogger {
    log() {}
    warn() {}
    error() {}
  }
  return {
    PinoLoggerService: FakeLogger,
    createCircuitBreakerMetrics: () => ({
      recordDecision() {},
      recordTransition() {},
      recordL1Hit() {},
      recordRedisError() {},
      recordDecideDuration() {},
    }),
  };
});

const { executeAgentCall } = await import(
  "../../src/temporal/activities/agent-call.activity"
);

describe("executeAgentCall", () => {
  beforeEach(() => {
    executeAndWaitMock.mockReset();
    executeAndWaitMock.mockResolvedValue({
      executionId: "exec-1",
      tenantId: "tenant-a",
      type: "chat",
      state: "completed",
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      agentId: "agent-uuid-1",
      result: { reply: "hello", tool_calls: [] },
    });
    mockActivityContext = null;
  });

  it("waits for a durable YoizenClaw execution result", async () => {
    const result = await executeAgentCall(
      { agentId: "agent-uuid-1", message: "Hi" },
      "tenant-a",
    );

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ reply: "hello", tool_calls: [] });
    expect(result.headers["x-yoizen-execution-id"]).toBe("exec-1");
    expect(executeAndWaitMock).toHaveBeenCalledTimes(1);
    expect(executeAndWaitMock).toHaveBeenCalledWith(
      "tenant-a",
      { agentId: "agent-uuid-1", message: "Hi" },
      900000,
      { requestedBy: undefined, correlationId: undefined },
    );
  });

  it("passes user and conversation metadata into execution submission", async () => {
    await executeAgentCall(
      {
        agentId: "a1",
        message: "m",
        conversationId: "conv-1",
        userId: "user-42",
      },
      "t1",
    );

    expect(executeAndWaitMock).toHaveBeenCalledWith(
      "t1",
      {
        agentId: "a1",
        message: "m",
        conversationId: "conv-1",
        userId: "user-42",
      },
      900000,
      { requestedBy: "user-42", correlationId: "conv-1" },
    );
  });

  /**
   * Post-mortem (`post-mortem/POST-MORTEM.md` §P1.3 fix 2): when
   * running inside an activity, the executionId MUST be derived from
   * `Context.current()` so every Temporal retry of the same
   * invocation collapses inside JetStream's `duplicate_window` and
   * does NOT trigger a brand-new LLM call.
   */
  it("forwards a stable executionId derived from Temporal Context (runId:activityId)", async () => {
    mockActivityContext = {
      info: {
        workflowExecution: {
          runId: "run-abc-123",
          workflowId: "wf-1",
        },
        activityId: "act-7",
      },
    };

    await executeAgentCall(
      { agentId: "agent-uuid-1", message: "Hi" },
      "tenant-a",
    );

    expect(executeAndWaitMock).toHaveBeenCalledWith(
      "tenant-a",
      { agentId: "agent-uuid-1", message: "Hi" },
      900000,
      {
        requestedBy: undefined,
        correlationId: undefined,
        executionId: "run-abc-123:act-7",
      },
    );
  });

  it("produces the same executionId across two attempts of the same activity invocation", async () => {
    mockActivityContext = {
      info: {
        workflowExecution: { runId: "run-stable", workflowId: "wf-1" },
        activityId: "act-1",
      },
    };

    await executeAgentCall({ agentId: "a", message: "m" }, "t");
    await executeAgentCall({ agentId: "a", message: "m" }, "t");

    const first = executeAndWaitMock.mock.calls[0]?.[3] as {
      executionId?: string;
    };
    const second = executeAndWaitMock.mock.calls[1]?.[3] as {
      executionId?: string;
    };
    expect(first?.executionId).toBe("run-stable:act-1");
    expect(second?.executionId).toBe("run-stable:act-1");
  });

  it("omits executionId when called outside an activity context (legacy fallback)", async () => {
    mockActivityContext = null;

    await executeAgentCall({ agentId: "a", message: "m" }, "t");

    const opts = executeAndWaitMock.mock.calls[0]?.[3] as {
      executionId?: string;
    };
    expect(opts.executionId).toBeUndefined();
  });
});
