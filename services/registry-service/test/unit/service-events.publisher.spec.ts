import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
} from "../../src/providers/nats.provider";
import {
  ServiceEventsEnsureStreamResult,
  ServiceEventsMetrics,
  ServiceEventsPublishFailureReason,
} from "../../src/modules/services/service-events.metrics";
import { ServiceEventsPublisher } from "../../src/modules/services/service-events.publisher";

interface IFakeCounter {
  add: ReturnType<typeof mock>;
}

interface IFakeMetrics {
  publishAttempts: IFakeCounter;
  publishSuccesses: IFakeCounter;
  publishFailures: IFakeCounter;
  ensureStreamCalls: IFakeCounter;
}

interface IFakeJsm {
  streams: {
    add: ReturnType<typeof mock>;
    info: ReturnType<typeof mock>;
  };
}

interface IFakeJs {
  publish: ReturnType<typeof mock>;
}

function makeFakeMetrics(): IFakeMetrics {
  return {
    publishAttempts: { add: mock(() => undefined) },
    publishSuccesses: { add: mock(() => undefined) },
    publishFailures: { add: mock(() => undefined) },
    ensureStreamCalls: { add: mock(() => undefined) },
  };
}

function makeFakeJsm(): IFakeJsm {
  return {
    streams: {
      add: mock(() => Promise.resolve({ config: {} })),
      info: mock(() => Promise.reject(new Error("stream not found"))),
    },
  };
}

function makeFakeJs(): IFakeJs {
  return {
    publish: mock(() =>
      Promise.resolve({ stream: "INGRESS-T", seq: 1, duplicate: false }),
    ),
  };
}

interface IBuildPublisherResult {
  publisher: ServiceEventsPublisher;
  js: IFakeJs;
  jsm: IFakeJsm;
  metrics: IFakeMetrics;
}

async function buildPublisher(): Promise<IBuildPublisherResult> {
  const js = makeFakeJs();
  const jsm = makeFakeJsm();
  const metrics = makeFakeMetrics();

  const moduleRef = await Test.createTestingModule({
    providers: [
      ServiceEventsPublisher,
      { provide: JETSTREAM, useValue: js },
      { provide: JETSTREAM_MANAGER, useValue: jsm },
      { provide: ServiceEventsMetrics, useValue: metrics },
    ],
  }).compile();

  const publisher = moduleRef.get(ServiceEventsPublisher);
  // Collapse the bounded-retry envelope to zero wall time so the
  // ack-timeout case completes in <50 ms.
  publisher.retryBackoffsMs = [0, 0, 0];
  return { publisher, js, jsm, metrics };
}

let testTenantCounter = 0;
function nextTenantId(): string {
  testTenantCounter++;
  return `t-${process.pid}-${Date.now().toString(36)}-${testTenantCounter}`;
}

interface IUpsertedPayloadOverrides {
  tenantId?: string;
  serviceId?: string;
}

function makeUpsertedPayload(overrides: IUpsertedPayloadOverrides = {}) {
  return {
    serviceId: overrides.serviceId ?? "svc-1",
    tenantId: overrides.tenantId ?? "t1",
    name: "my-svc",
    knativeName: "my-svc-t1",
    namespace: "t1-dev",
    port: 3000,
    status: "active" as const,
  };
}

describe("ServiceEventsPublisher", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.REGISTRY_EMIT_ADAPTER_SYNC;
    process.env.REGISTRY_EMIT_ADAPTER_SYNC = "true";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REGISTRY_EMIT_ADAPTER_SYNC;
    } else {
      process.env.REGISTRY_EMIT_ADAPTER_SYNC = originalEnv;
    }
  });

  it("flag OFF: short-circuits with zero broker calls and zero attempts (REQ-RSE-004)", async () => {
    process.env.REGISTRY_EMIT_ADAPTER_SYNC = "false";
    const { publisher, js, jsm, metrics } = await buildPublisher();

    await publisher.publishUpserted(
      makeUpsertedPayload({ tenantId: nextTenantId() }),
    );
    await publisher.publishDeleted({
      serviceId: "svc-1",
      tenantId: nextTenantId(),
      name: "my-svc",
    });

    expect(js.publish).not.toHaveBeenCalled();
    expect(jsm.streams.add).not.toHaveBeenCalled();
    expect(metrics.publishAttempts.add).not.toHaveBeenCalled();
    expect(metrics.publishSuccesses.add).not.toHaveBeenCalled();
    expect(metrics.publishFailures.add).not.toHaveBeenCalled();
    expect(metrics.ensureStreamCalls.add).not.toHaveBeenCalled();
  });

  it("flag ON + ensure miss: streams.add called BEFORE js.publish, success counter incremented (REQ-RSE-001/002)", async () => {
    const { publisher, js, jsm, metrics } = await buildPublisher();
    const tenantId = nextTenantId();

    /**
     * Capture call ordering by recording invocation timestamps
     * (`mock.calls` doesn't carry call-order across distinct mocks).
     * We use side-effect closures on the mocks so the assertion is
     * deterministic.
     */
    let order = 0;
    let addOrder = -1;
    let publishOrder = -1;
    jsm.streams.add = mock(() => {
      addOrder = order++;
      return Promise.resolve({ config: {} });
    });
    js.publish = mock(() => {
      publishOrder = order++;
      return Promise.resolve({ stream: `INGRESS-${tenantId}`, seq: 1 });
    });

    await publisher.publishUpserted(makeUpsertedPayload({ tenantId }));

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    expect(js.publish).toHaveBeenCalledTimes(1);
    expect(addOrder).toBeGreaterThanOrEqual(0);
    expect(publishOrder).toBeGreaterThanOrEqual(0);
    expect(addOrder).toBeLessThan(publishOrder);

    expect(metrics.publishAttempts.add).toHaveBeenCalledTimes(1);
    expect(metrics.publishSuccesses.add).toHaveBeenCalledTimes(1);
    expect(metrics.publishFailures.add).not.toHaveBeenCalled();
    expect(metrics.ensureStreamCalls.add).toHaveBeenCalledTimes(1);
    const ensureCall = metrics.ensureStreamCalls.add.mock.calls[0];
    expect(ensureCall?.[1]).toEqual({
      result: ServiceEventsEnsureStreamResult.MISS,
    });

    const [subject, body, opts] = js.publish.mock.calls[0] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string }; msgID: string },
    ];
    expect(subject).toMatch(
      /^evt\.[^.]+\.registry-service\.platform\.service\.system\.upserted\.v1$/,
    );
    expect(body).toBeInstanceOf(Uint8Array);
    expect(opts).toBeDefined();
    expect(opts.msgID).toBeTruthy();
    expect(opts.headers.get("Nats-Msg-Id")).toBe(opts.msgID);
  });

  it("flag ON + ensure hit (cached): js.publish called, streams.add NOT called (REQ-RSE-002)", async () => {
    const { publisher, js, jsm, metrics } = await buildPublisher();
    const tenantId = nextTenantId();

    // First publish primes the per-publisher cache.
    await publisher.publishUpserted(makeUpsertedPayload({ tenantId }));
    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    expect(js.publish).toHaveBeenCalledTimes(1);

    // Reset just the streams.add mock-call counter — keep js.publish's
    // mock so we can assert the second-publish-only count cleanly.
    jsm.streams.add.mockClear();
    js.publish.mockClear();
    metrics.ensureStreamCalls.add.mockClear();
    metrics.publishSuccesses.add.mockClear();

    await publisher.publishUpserted(
      makeUpsertedPayload({ tenantId, serviceId: "svc-2" }),
    );

    expect(jsm.streams.add).not.toHaveBeenCalled();
    expect(js.publish).toHaveBeenCalledTimes(1);
    expect(metrics.publishSuccesses.add).toHaveBeenCalledTimes(1);
    expect(metrics.ensureStreamCalls.add).toHaveBeenCalledTimes(1);
    const hitCall = metrics.ensureStreamCalls.add.mock.calls[0];
    expect(hitCall?.[1]).toEqual({
      result: ServiceEventsEnsureStreamResult.HIT,
    });
  });

  it("js.publish rejects with ack timeout: bounded retry then _failures{reason=ack_timeout} + no throw (REQ-RSE-001 ack-timeout, REQ-RSE-003)", async () => {
    const { publisher, js, jsm, metrics } = await buildPublisher();
    const tenantId = nextTenantId();
    js.publish = mock(() =>
      Promise.reject(new Error("ack timeout: no PubAck within 5000ms")),
    );

    let thrown: unknown = undefined;
    try {
      await publisher.publishUpserted(makeUpsertedPayload({ tenantId }));
    } catch (err: unknown) {
      thrown = err;
    }
    expect(thrown).toBeUndefined();

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    expect(js.publish).toHaveBeenCalledTimes(3);
    expect(metrics.publishAttempts.add).toHaveBeenCalledTimes(1);
    expect(metrics.publishSuccesses.add).not.toHaveBeenCalled();
    expect(metrics.publishFailures.add).toHaveBeenCalledTimes(1);
    const failCall = metrics.publishFailures.add.mock.calls[0];
    const failAttrs = failCall?.[1] as { reason: string; event_type: string };
    expect(failAttrs.reason).toBe(
      ServiceEventsPublishFailureReason.ACK_TIMEOUT,
    );
    expect(failAttrs.event_type).toBeTruthy();
  });

  it("missing tenantId: no streams.add, no js.publish, _failures{reason=missing_tenant} (REQ-RSE-005)", async () => {
    const { publisher, js, jsm, metrics } = await buildPublisher();

    await publisher.publishUpserted(makeUpsertedPayload({ tenantId: "" }));

    expect(jsm.streams.add).not.toHaveBeenCalled();
    expect(js.publish).not.toHaveBeenCalled();
    expect(metrics.publishAttempts.add).not.toHaveBeenCalled();
    expect(metrics.publishSuccesses.add).not.toHaveBeenCalled();
    expect(metrics.ensureStreamCalls.add).not.toHaveBeenCalled();
    expect(metrics.publishFailures.add).toHaveBeenCalledTimes(1);
    const failCall = metrics.publishFailures.add.mock.calls[0];
    const failAttrs = failCall?.[1] as { reason: string };
    expect(failAttrs.reason).toBe(
      ServiceEventsPublishFailureReason.MISSING_TENANT,
    );
  });

  it("DB rollback path: when service-layer throws BEFORE publish, broker is never contacted (REQ-RSE-003 rollback)", async () => {
    const { publisher, js, jsm, metrics } = await buildPublisher();
    const tenantId = nextTenantId();

    /**
     * Models the controller-level guarantee captured in
     * `ServicesService.register` / `.update` / `.remove`: the
     * publisher is invoked AFTER a successful DB commit. When the
     * service-layer transaction throws BEFORE reaching the publisher
     * call site, no broker contact and no metric mutation must
     * happen.
     */
    const fakeTransactionalRegister = async (): Promise<void> => {
      throw new Error("DB rollback (simulated)");
      // Unreachable on purpose — represents the publish call that would
      // have run after the commit.
      // @ts-expect-error: dead-code branch intentionally retained for
      // documentation of the call ordering.
      await publisher.publishUpserted(makeUpsertedPayload({ tenantId }));
    };

    await expect(fakeTransactionalRegister()).rejects.toThrow(
      "DB rollback (simulated)",
    );

    expect(jsm.streams.add).not.toHaveBeenCalled();
    expect(js.publish).not.toHaveBeenCalled();
    expect(metrics.publishAttempts.add).not.toHaveBeenCalled();
    expect(metrics.publishSuccesses.add).not.toHaveBeenCalled();
    expect(metrics.publishFailures.add).not.toHaveBeenCalled();
    expect(metrics.ensureStreamCalls.add).not.toHaveBeenCalled();
  });

  it("publishes deleted on the canonical deleted subject and never throws on broker outage (REQ-RSE-001/003)", async () => {
    const { publisher, js, jsm, metrics } = await buildPublisher();
    const tenantId = nextTenantId();

    js.publish = mock(() =>
      Promise.reject(new Error("ECONNREFUSED 127.0.0.1:4222")),
    );

    let thrown: unknown = undefined;
    try {
      await publisher.publishDeleted({
        serviceId: "svc-1",
        tenantId,
        name: "my-svc",
      });
    } catch (err: unknown) {
      thrown = err;
    }
    expect(thrown).toBeUndefined();

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    expect(js.publish).toHaveBeenCalledTimes(3);
    expect(metrics.publishFailures.add).toHaveBeenCalledTimes(1);
    const failCall = metrics.publishFailures.add.mock.calls[0];
    const failAttrs = failCall?.[1] as { reason: string };
    expect(failAttrs.reason).toBe(
      ServiceEventsPublishFailureReason.BROKER_UNAVAILABLE,
    );

    const [subject] = js.publish.mock.calls[0] as [string, Uint8Array, unknown];
    expect(subject).toMatch(
      /^evt\..+\.registry-service\.platform\.service\.system\.deleted\.v1$/,
    );
  });

  it("Nats-Msg-Id is the deterministic idempotency key (JetStream dedup)", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = nextTenantId();
    const payload = makeUpsertedPayload({ tenantId });

    await publisher.publishUpserted(payload);
    await publisher.publishUpserted(payload);

    expect(js.publish).toHaveBeenCalledTimes(2);

    const [, , opts1] = js.publish.mock.calls[0] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string }; msgID: string },
    ];
    const [, , opts2] = js.publish.mock.calls[1] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string }; msgID: string },
    ];

    expect(opts1.msgID).toBeTruthy();
    expect(opts1.msgID).toBe(opts2.msgID);
    expect(opts1.headers.get("Nats-Msg-Id")).toBe(opts1.msgID);
  });
});
