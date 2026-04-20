import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";

let tracedFetchMock: ReturnType<typeof mock>;

const mockRedisInstance = {
  script: mock(() => Promise.resolve("sha-fake")),
  evalsha: mock(() => Promise.resolve(["allow", "closed", ""])),
  eval: mock(() => Promise.resolve(["allow", "closed", ""])),
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

mock.module("@yoizen/observability", () => {
  tracedFetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ reply: "hello" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  class FakeLogger {
    log() {}
    warn() {}
    error() {}
  }
  return {
    tracedFetch: tracedFetchMock,
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
  "../../src/activities/agent-call.activity"
);

describe("executeAgentCall", () => {
  beforeEach(() => {
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ reply: "hello" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  it("POSTs chat JSON to yoizenclaw admin agents chat URL", async () => {
    const result = await executeAgentCall(
      { agentId: "agent-uuid-1", message: "Hi" },
      "tenant-a",
    );

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ reply: "hello" });
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = tracedFetchMock.mock.calls[0];
    expect(url).toContain("/admin/agents/agent-uuid-1/chat");
    expect(init.method).toBe("POST");
    expect(init.headers["x-yoizen-tenant"]).toBe("tenant-a");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ message: "Hi" });
  });

  it("includes optional chat fields and user header when userId set", async () => {
    await executeAgentCall(
      {
        agentId: "a1",
        message: "m",
        conversationId: "conv-1",
        userId: "user-42",
      },
      "t1",
    );

    const [, init] = tracedFetchMock.mock.calls[0];
    expect(init.headers["x-yoizen-user-id"]).toBe("user-42");
    expect(JSON.parse(init.body as string)).toEqual({
      message: "m",
      conversationId: "conv-1",
      userId: "user-42",
    });
  });
});
