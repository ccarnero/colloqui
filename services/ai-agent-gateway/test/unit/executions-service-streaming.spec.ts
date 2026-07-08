import { beforeEach, describe, expect, it, mock } from "bun:test";
import type Redis from "ioredis";
import type { JetStreamClient, JetStreamManager, NatsConnection } from "nats";

mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

// ensureTenantIngressStream is called from submitAndStream — stub it out so
// we don't need a real JetStreamManager.
mock.module("@yoizen/database", () => ({
  ensureTenantIngressStream: mock(() => Promise.resolve()),
  MultiTenantConsumerManager: class {
    start = mock(() => Promise.resolve());
    stop = mock(() => Promise.resolve());
  },
  REDIS_CLIENT: "REDIS_CLIENT",
}));

import type { CreateExecutionDto } from "../../src/modules/executions/executions.dto";
import { ExecutionsService } from "../../src/modules/executions/executions.service";

type SubscribeCallback = (
  error: Error | null,
  msg: { subject: string; data: Uint8Array; json: () => unknown }
) => void;

describe("ExecutionsService.submitAndStream (DOCS/architecture/runtime-streaming.md)", () => {
  let service: ExecutionsService;
  let mockJs: { publish: ReturnType<typeof mock> };
  let mockJsm: object;
  let subscriptionsBySubject: Map<string, SubscribeCallback>;
  let mockNc: {
    subscribe: ReturnType<typeof mock>;
    publish: ReturnType<typeof mock>;
    jetstream: ReturnType<typeof mock>;
  };
  let mockRedis: {
    setex: ReturnType<typeof mock>;
    get: ReturnType<typeof mock>;
    del: ReturnType<typeof mock>;
  };
  let submitExecutionSpy: ReturnType<typeof mock>;

  const dto: CreateExecutionDto = {
    agentId: "11111111-1111-1111-1111-111111111111",
    message: "hi",
  } as CreateExecutionDto;

  function fire(subject: string, payload: unknown): void {
    const cb = subscriptionsBySubject.get(subject);
    if (!cb) {
      throw new Error(`No subscriber registered for '${subject}'`);
    }
    const raw = JSON.stringify({ data: { payload } });
    cb(null, {
      subject,
      data: new TextEncoder().encode(raw),
      json: () => JSON.parse(raw),
    });
  }

  /** Extracts the real, internally-generated executionId from a subscribed
   * `rt.<tenant>.exec.<executionId>.<kind>` subject — submitAndStream
   * generates it via randomUUID() and never returns it synchronously, so
   * tests that need to fire a matching lifecycle/token event must read it
   * back from the subject the service itself subscribed to. */
  function extractExecutionId(subjects: string[]): string {
    const tokenSubject = subjects.find((s) => s.startsWith("rt."))!;
    const parts = tokenSubject.split(".");
    return parts[3]!; // rt.<tenant>.exec.<executionId>.<kind>
  }

  beforeEach(() => {
    subscriptionsBySubject = new Map();
    mockJs = { publish: mock(() => Promise.resolve()) };
    mockJsm = {};
    mockNc = {
      subscribe: mock(
        (subject: string, opts: { callback: SubscribeCallback }) => {
          subscriptionsBySubject.set(subject, opts.callback);
          return { unsubscribe: mock(() => {}) };
        }
      ),
      publish: mock(() => {}),
      jetstream: mock(() => mockJs),
    };
    mockRedis = {
      setex: mock(() => Promise.resolve()),
      get: mock(() => Promise.resolve(null)),
      del: mock(() => Promise.resolve()),
    };

    service = new ExecutionsService(
      mockJs as unknown as JetStreamClient,
      mockJsm as unknown as JetStreamManager,
      mockNc as unknown as NatsConnection,
      mockRedis as unknown as Redis
    );

    // Spy on the underlying YoizenClawExecutionClient.submitExecution via
    // the service's private `client` field (constructed internally).
    submitExecutionSpy = mock(() =>
      Promise.resolve({
        executionId: "will-be-overwritten",
        status: "accepted",
      })
    );
    (service as any).client.submitExecution = submitExecutionSpy;
    (service as any).client.publishCancel = mock(() => Promise.resolve());
  });

  it("subscribes to token/tool subjects and lifecycle subjects BEFORE submitting (subscribe-before-submit, §2.1)", async () => {
    const events: unknown[] = [];
    const sub = service
      .submitAndStream("acme", dto)
      .subscribe((e) => events.push(e));

    // Let the microtask queue flush the ensureTenantIngressStream().then(submit) chain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // subscribe() calls happened synchronously during .subscribe(), i.e.
    // strictly before submitExecutionSpy (awaited via a promise chain) runs.
    expect(mockNc.subscribe.mock.calls.length).toBeGreaterThanOrEqual(6); // 3 token/tool + 3 lifecycle
    expect(submitExecutionSpy).toHaveBeenCalledTimes(1);

    const subjects = mockNc.subscribe.mock.calls.map((c) => c[0] as string);
    expect(subjects.some((s) => s.includes(".token"))).toBe(true);
    expect(subjects.some((s) => s.includes(".tool_call"))).toBe(true);
    expect(subjects.some((s) => s.includes(".tool_result"))).toBe(true);
    expect(subjects.some((s) => s.includes("execution_started"))).toBe(true);
    expect(subjects.some((s) => s.includes("execution_completed"))).toBe(true);
    expect(subjects.some((s) => s.includes("execution_failed"))).toBe(true);

    sub.unsubscribe();
  });

  it("relays a token event received on the rt. subject as a MessageEvent", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const sub = service
      .submitAndStream("acme", dto)
      .subscribe((e) => events.push(e as any));
    await Promise.resolve();
    await Promise.resolve();

    const subjectsAfterSub = mockNc.subscribe.mock.calls.map(
      (c) => c[0] as string
    );
    const executionId = extractExecutionId(subjectsAfterSub);
    const tokenSubject = subjectsAfterSub.find((s) => s.endsWith(".token"))!;

    fire(tokenSubject, { executionId, seq: 0, delta: "Hello" });

    expect(events.some((e) => e.type === "token")).toBe(true);
    sub.unsubscribe();
  });

  it("does NOT kill a long token stream when the consumer keeps up (backpressure, not total length, §2.4)", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const fastSocket = {
      writableLength: 0,
    } as unknown as import("node:net").Socket;
    const sub = service
      .submitAndStream("acme", dto, undefined, fastSocket)
      .subscribe((e) => events.push(e as any));
    await Promise.resolve();
    await Promise.resolve();

    const subjectsAfterSub = mockNc.subscribe.mock.calls.map(
      (c) => c[0] as string
    );
    const executionId = extractExecutionId(subjectsAfterSub);
    const tokenSubject = subjectsAfterSub.find((s) => s.endsWith(".token"))!;

    // Far beyond the old 256-event total cap — a draining consumer must
    // receive every token, however long the stream runs.
    for (let seq = 0; seq < 1000; seq++) {
      fire(tokenSubject, { executionId, seq, delta: `t${seq}` });
    }

    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBe(1000);
    expect(events.some((e) => e.type === "failed")).toBe(false);
    sub.unsubscribe();
  });

  it("closes with failed{reason:'slow_consumer'} when the socket buffer exceeds the bound (§2.4)", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    let completed = false;
    const stalledSocket = {
      writableLength: 256 * 1024 + 1,
    } as unknown as import("node:net").Socket;
    service.submitAndStream("acme", dto, undefined, stalledSocket).subscribe({
      next: (e) => events.push(e as any),
      complete: () => {
        completed = true;
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const subjectsAfterSub = mockNc.subscribe.mock.calls.map(
      (c) => c[0] as string
    );
    const executionId = extractExecutionId(subjectsAfterSub);
    const tokenSubject = subjectsAfterSub.find((s) => s.endsWith(".token"))!;

    fire(tokenSubject, { executionId, seq: 0, delta: "x" });

    const failed = events.find((e) => e.type === "failed") as
      | { type: string; data: { reason?: string } }
      | undefined;
    expect(failed?.data?.reason).toBe("slow_consumer");
    expect(completed).toBe(true);
  });

  it("completes the observable on a completed lifecycle event", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    let completed = false;
    service.submitAndStream("acme", dto).subscribe({
      next: (e) => events.push(e as any),
      complete: () => {
        completed = true;
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const subjectsAfterSub = mockNc.subscribe.mock.calls.map(
      (c) => c[0] as string
    );
    const executionId = extractExecutionId(subjectsAfterSub);
    const completedSubject = subjectsAfterSub.find((s) =>
      s.includes("execution_completed")
    )!;

    fire(completedSubject, {
      executionId,
      state: "completed",
      response: "hi",
    });

    expect(completed).toBe(true);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });

  it("publishes cancel on client disconnect (unsubscribe) before a terminal event", async () => {
    const sub = service.submitAndStream("acme", dto).subscribe();
    await Promise.resolve();
    await Promise.resolve();

    sub.unsubscribe();

    expect((service as any).client.publishCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT publish cancel on teardown after a terminal event already occurred", async () => {
    const sub = service.submitAndStream("acme", dto).subscribe();
    await Promise.resolve();
    await Promise.resolve();

    const subjectsAfterSub = mockNc.subscribe.mock.calls.map(
      (c) => c[0] as string
    );
    const executionId = extractExecutionId(subjectsAfterSub);
    const completedSubject = subjectsAfterSub.find((s) =>
      s.includes("execution_completed")
    )!;
    fire(completedSubject, {
      executionId,
      state: "completed",
      response: "hi",
    });

    sub.unsubscribe();

    expect((service as any).client.publishCancel).not.toHaveBeenCalled();
  });
});
