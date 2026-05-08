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

mock.module("ioredis", () => {
  return {
    default: class Redis {
      constructor() {
        return mockRedisInstance;
      }
    },
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
      300000,
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
      300000,
      { requestedBy: "user-42", correlationId: "conv-1" },
    );
  });
});
