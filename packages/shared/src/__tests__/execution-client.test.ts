import { describe, expect, it, mock } from "bun:test";
import type { YoizenClawExecutionStatus } from "../execution.interfaces";
import { YoizenClawExecutionClient } from "../execution-client";

/**
 * Regression tests for correlation-chain fix 3 (post-review bug): the HOT
 * resolution path of `waitForExecutionResult` (NATS subscription) resolved
 * the raw `data.payload` and dropped the envelope-level `id`/`transport.depth`,
 * so `completedEventId` never reached workflow-service even though the
 * gateway projector persisted it to Redis (only read on pre-check/timeout).
 * The subscription path must perform the same enrichment.
 */

type SubscribeCallback = (
  error: Error | null,
  msg: { data: Uint8Array }
) => void;

function createClient() {
  const callbacks: SubscribeCallback[] = [];
  const nc = {
    subscribe: mock(
      (_subject: string, opts: { callback: SubscribeCallback }) => {
        callbacks.push(opts.callback);
        return { unsubscribe: mock(() => {}) };
      }
    ),
    publish: mock(() => {}),
  };
  const cache = {
    get: mock(() => Promise.resolve(null)),
    setex: mock(() => Promise.resolve("OK")),
    del: mock(() => Promise.resolve(1)),
  };
  const js = { publish: mock(() => Promise.resolve()) };
  const client = new YoizenClawExecutionClient({
    nc: nc as never,
    js: js as never,
    cache: cache as never,
    serviceName: "test-service",
  });
  return { client, callbacks };
}

function fire(callbacks: SubscribeCallback[], envelope: unknown): void {
  const data = new TextEncoder().encode(JSON.stringify(envelope));
  for (const cb of callbacks) {
    cb(null, { data });
  }
}

async function waitForSubscriptions(callbacks: SubscribeCallback[]) {
  // Subscriptions register after the awaited Redis pre-check; yield until
  // the client has installed them.
  for (let i = 0; i < 10 && callbacks.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  expect(callbacks.length).toBeGreaterThan(0);
}

describe("waitForExecutionResult subscription path (completed-event threading)", () => {
  it("enriches the resolved status with the envelope id and depth on completed", async () => {
    const { client, callbacks } = createClient();
    const pending = client.waitForExecutionResult("tenant-a", "exec-1", 5000);
    await waitForSubscriptions(callbacks);

    fire(callbacks, {
      id: "evt-completed-1",
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
    });

    const status: YoizenClawExecutionStatus = await pending;
    expect(status.completedEventId).toBe("evt-completed-1");
    expect(status.completedEventDepth).toBe(3);
    expect(status.executionId).toBe("exec-1");
    expect(status.state).toBe("completed");
  });

  it("returns the payload unchanged when the envelope carries no id (legacy shape)", async () => {
    const { client, callbacks } = createClient();
    const pending = client.waitForExecutionResult("tenant-a", "exec-1", 5000);
    await waitForSubscriptions(callbacks);

    fire(callbacks, {
      data: {
        payload: {
          executionId: "exec-1",
          tenantId: "tenant-a",
          agentId: "agent-1",
          state: "completed",
        },
      },
    });

    const status = await pending;
    expect(status.state).toBe("completed");
    expect("completedEventId" in status).toBe(false);
    expect("completedEventDepth" in status).toBe(false);
  });

  it("does not enrich failed states even when the envelope carries an id", async () => {
    const { client, callbacks } = createClient();
    const pending = client.waitForExecutionResult("tenant-a", "exec-1", 5000);
    await waitForSubscriptions(callbacks);

    fire(callbacks, {
      id: "evt-failed-1",
      transport: { depth: 3 },
      data: {
        payload: {
          executionId: "exec-1",
          tenantId: "tenant-a",
          agentId: "agent-1",
          state: "failed",
        },
      },
    });

    const status = await pending;
    expect(status.state).toBe("failed");
    expect("completedEventId" in status).toBe(false);
    expect("completedEventDepth" in status).toBe(false);
  });
});
