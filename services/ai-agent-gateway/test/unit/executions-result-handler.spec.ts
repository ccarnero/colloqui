import { beforeEach, describe, expect, it, mock } from "bun:test";
import type Redis from "ioredis";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  NatsConnection,
} from "nats";

mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

mock.module("@yoizen/database", () => ({
  ensureTenantIngressStream: mock(() => Promise.resolve()),
  MultiTenantConsumerManager: class {
    start = mock(() => Promise.resolve());
    stop = mock(() => Promise.resolve());
  },
  REDIS_CLIENT: "REDIS_CLIENT",
}));

import { ExecutionsService } from "../../src/modules/executions/executions.service";

/**
 * Regression tests for correlation-chain fix 3: the result projector must
 * thread the `execution_completed` bus envelope id (and its causal depth)
 * into the Redis-persisted execution status, so workflow-service can cite
 * it as `causation_id` in subsequent publications.
 */
describe("ExecutionsService.handleResultMessage (completed-event threading)", () => {
  let service: ExecutionsService;
  let mockRedis: {
    setex: ReturnType<typeof mock>;
    get: ReturnType<typeof mock>;
    del: ReturnType<typeof mock>;
  };

  function buildMsg(envelope: Record<string, unknown>): JsMsg {
    return {
      data: new TextEncoder().encode(JSON.stringify(envelope)),
      headers: undefined,
    } as unknown as JsMsg;
  }

  function persistedStatus(): Record<string, unknown> {
    expect(mockRedis.setex).toHaveBeenCalled();
    const lastCall = mockRedis.setex.mock.calls.at(-1) as unknown[];
    return JSON.parse(lastCall[2] as string);
  }

  beforeEach(() => {
    mockRedis = {
      setex: mock(() => Promise.resolve("OK")),
      get: mock(() => Promise.resolve(null)),
      del: mock(() => Promise.resolve(1)),
    };
    const mockJs = { publish: mock(() => Promise.resolve()) };
    const mockNc = {
      subscribe: mock(() => ({ unsubscribe() {} })),
      publish: mock(() => {}),
      jetstream: mock(() => mockJs),
    };
    service = new ExecutionsService(
      mockJs as unknown as JetStreamClient,
      {} as JetStreamManager,
      mockNc as unknown as NatsConnection,
      mockRedis as unknown as Redis
    );
  });

  it("persists the completed envelope id and depth into the execution status", async () => {
    await (
      service as unknown as {
        handleResultMessage(msg: JsMsg): Promise<void>;
      }
    ).handleResultMessage(
      buildMsg({
        id: "evt-completed-1",
        tenant: "tenant-a",
        transport: { method: "stream", protocol: "internal", depth: 3 },
        data: {
          payload: {
            executionId: "exec-1",
            tenantId: "tenant-a",
            agentId: "agent-1",
            state: "completed",
            response: "ok",
          },
        },
      })
    );

    const status = persistedStatus();
    expect(status.completedEventId).toBe("evt-completed-1");
    expect(status.completedEventDepth).toBe(3);
    expect(status.executionId).toBe("exec-1");
    expect(status.state).toBe("completed");
  });

  it("does not attach a completed event id to non-completed states", async () => {
    await (
      service as unknown as {
        handleResultMessage(msg: JsMsg): Promise<void>;
      }
    ).handleResultMessage(
      buildMsg({
        id: "evt-started-1",
        tenant: "tenant-a",
        transport: { depth: 3 },
        data: {
          payload: {
            executionId: "exec-1",
            tenantId: "tenant-a",
            agentId: "agent-1",
            state: "started",
          },
        },
      })
    );

    const status = persistedStatus();
    expect(status.completedEventId).toBeUndefined();
    expect(status.completedEventDepth).toBeUndefined();
  });

  it("persists the status unchanged when the envelope carries no id (legacy shape)", async () => {
    await (
      service as unknown as {
        handleResultMessage(msg: JsMsg): Promise<void>;
      }
    ).handleResultMessage(
      buildMsg({
        tenant: "tenant-a",
        data: {
          payload: {
            executionId: "exec-1",
            tenantId: "tenant-a",
            agentId: "agent-1",
            state: "completed",
          },
        },
      })
    );

    const status = persistedStatus();
    expect(status.completedEventId).toBeUndefined();
    expect(status.completedEventDepth).toBeUndefined();
    expect(status.state).toBe("completed");
  });
});
