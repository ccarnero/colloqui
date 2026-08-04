import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type { JsMsg, JetStreamClient, JetStreamManager } from "nats";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  PermanentError,
  SERVICE_DELETED_EVENT_TYPE,
  SERVICE_UPSERTED_EVENT_TYPE,
  buildRegistryPlatformSubject,
  type EventEnvelope,
  type IServiceConfigDeletedPayload,
  type IServiceConfigUpsertedPayload,
} from "@yoizen/shared";
import { __resetServiceModeCacheForTests } from "@yoizen/observability";
import { InternalSyncService } from "../../src/modules/internal-sync/internal-sync.service";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
} from "../../src/providers/nats.provider";
import {
  ADAPTERS_REPOSITORY,
  type IAdaptersRepository,
} from "../../src/modules/adapters/adapters.repository.interface";
import { adapterInternalSyncCrossTenantAttemptTotal } from "../../src/modules/internal-sync/internal-sync.metrics";

/**
 * Stub the manager's lifecycle methods globally for the entire spec —
 * we never want a real reconcile loop or interval timer to run during
 * unit tests, but we still want the real constructor to run so that
 * `manager.handler`, `manager.config`, `manager.streamPattern` etc. are
 * populated for inspection.
 */
const startSpy = spyOn(
  MultiTenantConsumerManager.prototype,
  "start",
).mockImplementation(async function () {
  return;
});
const stopSpy = spyOn(
  MultiTenantConsumerManager.prototype,
  "stop",
).mockImplementation(async function () {
  return;
});

interface IManagerWithCapturedFields {
  readonly config: IMultiTenantConsumerConfig;
  readonly handler: (msg: JsMsg) => Promise<void>;
  readonly jsm: JetStreamManager;
  readonly js: JetStreamClient;
}

/**
 * Reads the captured constructor args off the live manager instance.
 * We read private fields via a typed cast — the alternative (mocking
 * the entire `@yoizen/database` module) would require us to re-export
 * dozens of helpers (`createNatsConnectionProvider`, `TenantGuard`,
 * `isPostgresUniqueViolation`, …) that other parts of the import graph
 * resolve at module-load time. The cast keeps the test surface minimal.
 */
function captured(service: InternalSyncService): IManagerWithCapturedFields {
  const manager = (service as unknown as { manager: unknown }).manager;
  if (!manager) {
    throw new Error("InternalSyncService manager was not constructed");
  }
  return manager as unknown as IManagerWithCapturedFields;
}

interface IUpsertCall {
  readonly tenantId: string;
  readonly serviceName: string;
}

function makeRepo(): {
  readonly repo: IAdaptersRepository;
  readonly upsertMirror: ReturnType<typeof mock>;
  readonly deleteMirrorByServiceName: ReturnType<typeof mock>;
  readonly upsertCalls: IUpsertCall[];
  readonly mirrorRows: Map<string, unknown>;
  readonly deleteCalls: IUpsertCall[];
} {
  const upsertCalls: IUpsertCall[] = [];
  /**
   * Map<`${tenant}::${name}`, row> — emulates the SQL upsert's
   * idempotency guarantee (REQ-ASIS-002): two upserts with the same
   * (tenant, name) leave exactly ONE row.
   */
  const mirrorRows = new Map<string, unknown>();
  const upsertMirror = mock(
    async (params: {
      readonly tenantId: string;
      readonly serviceName: string;
      readonly baseUrl: string;
      readonly healthCheckPath: string;
      readonly status: string;
      readonly managedBy: string;
    }) => {
      upsertCalls.push({
        tenantId: params.tenantId,
        serviceName: params.serviceName,
      });
      const key = `${params.tenantId}::${params.serviceName}`;
      mirrorRows.set(key, {
        id: "row-1",
        name: params.serviceName,
        base_url: params.baseUrl,
        managed_by: params.managedBy,
      });
      return mirrorRows.get(key);
    },
  );

  const deleteCalls: IUpsertCall[] = [];
  const deleteMirrorByServiceName = mock(
    async (tenantId: string, serviceName: string, _managedBy: string) => {
      deleteCalls.push({ tenantId, serviceName });
      const key = `${tenantId}::${serviceName}`;
      const had = mirrorRows.has(key);
      mirrorRows.delete(key);
      return had ? 1 : 0;
    },
  );

  const repo = {
    upsertMirror,
    deleteMirrorByServiceName,
  } as unknown as IAdaptersRepository;

  return {
    repo,
    upsertMirror,
    deleteMirrorByServiceName,
    upsertCalls,
    mirrorRows,
    deleteCalls,
  };
}

interface IBuildOptions {
  readonly mode?: "api" | "worker";
}

function setMode(mode: "api" | "worker"): void {
  process.env.SERVICE_MODE = mode;
  __resetServiceModeCacheForTests();
}

async function buildService(
  opts: IBuildOptions = {},
): Promise<{
  readonly service: InternalSyncService;
  readonly repo: ReturnType<typeof makeRepo>;
}> {
  setMode(opts.mode ?? "worker");

  const repo = makeRepo();
  const moduleRef = await Test.createTestingModule({
    providers: [
      InternalSyncService,
      { provide: JETSTREAM_MANAGER, useValue: {} as JetStreamManager },
      { provide: JETSTREAM, useValue: {} as JetStreamClient },
      { provide: ADAPTERS_REPOSITORY, useValue: repo.repo },
    ],
  }).compile();

  const service = moduleRef.get(InternalSyncService);
  await service.onModuleInit();
  return { service, repo };
}

function buildEnvelope(
  tenantId: string,
  type: string,
  payload: Partial<IServiceConfigUpsertedPayload> | Partial<IServiceConfigDeletedPayload>,
): EventEnvelope {
  return {
    specversion: "1.0",
    id: `id-${tenantId}-${type}`,
    source: "registry-service/services",
    type,
    resource: `tenant/${tenantId}/service/${(payload as { serviceId?: string }).serviceId ?? "svc"}`,
    time: new Date().toISOString(),
    traceid: "trace-1",
    causation_id: null,
    correlation_id: "corr-1",
    tenant: tenantId,
    producer: "registry-service",
    domain: "platform",
    channel: "service",
    provider: "system",
    accountid: tenantId,
    idempotencykey: "key-1",
    transport: { method: "stream", protocol: "internal", depth: 1 },
    data: {
      received_at: new Date().toISOString(),
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "",
      payload: payload as Record<string, unknown>,
    },
  };
}

function makeJsMsg(subject: string, body: string | object): JsMsg {
  const data =
    typeof body === "string"
      ? new TextEncoder().encode(body)
      : new TextEncoder().encode(JSON.stringify(body));
  return {
    subject,
    data,
    headers: undefined,
    seq: 1,
    info: { deliveryCount: 1 },
    ack: () => {},
    nak: () => {},
    term: () => {},
    working: () => {},
  } as unknown as JsMsg;
}

describe("InternalSyncService — durable consumer wiring", () => {
  beforeAll(() => {
    startSpy.mockClear();
    stopSpy.mockClear();
  });

  afterAll(() => {
    delete process.env.SERVICE_MODE;
    __resetServiceModeCacheForTests();
  });

  beforeEach(() => {
    startSpy.mockClear();
    stopSpy.mockClear();
  });

  it("constructs the manager with ensureOnly:true when SERVICE_MODE=api", async () => {
    const { service } = await buildService({ mode: "api" });
    const cap = captured(service);

    expect(cap.config.ensureOnly).toBe(true);
    expect(cap.config.durableName).toBe("adapter-internal-sync");
    expect(cap.config.streamPattern.test("INGRESS-acme")).toBe(true);
    expect(cap.config.filterSubject).toBe(
      "evt.*.registry-service.platform.service.system.*.v1",
    );
    expect(cap.config.runnerOptions?.concurrency).toBe(4);
    expect(cap.config.maxDeliver).toBe(5);
    expect(cap.config.ackWaitMs).toBe(60_000);
    expect(cap.config.backoffMs).toEqual([60_000, 120_000, 300_000, 600_000]);
    expect(startSpy).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("constructs the manager with ensureOnly:false when SERVICE_MODE=worker", async () => {
    const { service } = await buildService({ mode: "worker" });
    const cap = captured(service);

    expect(cap.config.ensureOnly).toBe(false);
    expect(cap.config.durableName).toBe("adapter-internal-sync");
    expect(cap.config.streamPattern.test("INGRESS-globex")).toBe(true);

    await service.onModuleDestroy();
  });

  it("streamPattern matches a freshly-onboarded tenant stream (REQ-ASIS-005)", async () => {
    const { service } = await buildService({ mode: "worker" });
    const cap = captured(service);

    /**
     * The manager's reconcile loop calls `streams.list()` every 5s and
     * binds a runner to each match. We verify here that the pattern
     * accepts a tenant added at runtime — the actual scheduling is
     * the manager's responsibility (covered by its own unit tests).
     */
    expect(cap.config.streamPattern.test("INGRESS-newco")).toBe(true);
    expect(cap.config.streamPattern.test("DLQ-newco")).toBe(false);

    await service.onModuleDestroy();
  });
});

describe("InternalSyncService — handler dispatch", () => {
  beforeAll(() => {
    startSpy.mockClear();
    stopSpy.mockClear();
  });

  afterAll(() => {
    delete process.env.SERVICE_MODE;
    __resetServiceModeCacheForTests();
  });

  it("redelivered upserted events converge to one mirror row (REQ-ASIS-002)", async () => {
    const { service, repo } = await buildService({ mode: "worker" });
    const cap = captured(service);

    const subject = buildRegistryPlatformSubject("acme", "service", "upserted");
    const payload: IServiceConfigUpsertedPayload = {
      serviceId: "svc-1",
      tenantId: "acme",
      name: "billing",
      knativeName: "billing-svc",
      namespace: "tenant-acme",
      port: 8080,
      status: "active",
    };
    const msg = makeJsMsg(
      subject,
      buildEnvelope("acme", SERVICE_UPSERTED_EVENT_TYPE, payload),
    );

    await cap.handler(msg);
    await cap.handler(msg);

    expect(repo.upsertCalls.length).toBe(2);
    expect(repo.mirrorRows.size).toBe(1);
    expect(repo.mirrorRows.has("acme::billing")).toBe(true);

    await service.onModuleDestroy();
  });

  it("deleted event redelivered after row removal is a no-op (REQ-ASIS-002)", async () => {
    const { service, repo } = await buildService({ mode: "worker" });
    const cap = captured(service);

    const subject = buildRegistryPlatformSubject("acme", "service", "deleted");
    const deletePayload: IServiceConfigDeletedPayload = {
      serviceId: "svc-1",
      tenantId: "acme",
      name: "billing",
    };

    repo.mirrorRows.set("acme::billing", { id: "row-1", name: "billing" });
    const msg = makeJsMsg(
      subject,
      buildEnvelope("acme", SERVICE_DELETED_EVENT_TYPE, deletePayload),
    );

    await cap.handler(msg);
    expect(repo.mirrorRows.has("acme::billing")).toBe(false);

    /**
     * Second delivery — the row no longer exists; the repository
     * returns `count: 0` and the handler must NOT throw (so the
     * runner ack()s the redelivery instead of nak/term).
     */
    await cap.handler(msg);
    expect(repo.deleteCalls.length).toBe(2);

    await service.onModuleDestroy();
  });

  it("cross-tenant attempt → PermanentError + metric increment (REQ-ASIS-006)", async () => {
    const { service, repo } = await buildService({ mode: "worker" });
    const cap = captured(service);

    const crossSpy = spyOn(
      adapterInternalSyncCrossTenantAttemptTotal,
      "add",
    );
    crossSpy.mockClear();

    const subject = buildRegistryPlatformSubject("acme", "service", "upserted");
    const payload: IServiceConfigUpsertedPayload = {
      serviceId: "svc-1",
      tenantId: "globex",
      name: "billing",
      knativeName: "billing-svc",
      namespace: "tenant-globex",
      port: 8080,
      status: "active",
    };
    const msg = makeJsMsg(
      subject,
      buildEnvelope("acme", SERVICE_UPSERTED_EVENT_TYPE, payload),
    );

    let caught: unknown = null;
    try {
      await cap.handler(msg);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PermanentError);
    expect((caught as PermanentError).reason).toBe("cross_tenant_attempt");
    expect(repo.upsertCalls.length).toBe(0);

    /**
     * The OTEL noop meter returns a shared `add` implementation across
     * all counters in the same provider, so we cannot rely on call
     * count alone — we filter the spy's calls for the labels emitted
     * by the cross-tenant tripwire specifically.
     */
    const crossTenantCalls = crossSpy.mock.calls.filter(
      (call: [unknown, unknown]) => {
        const attrs = call[1] as
          | { tenant_subject?: unknown; tenant_payload?: unknown }
          | undefined;
        return (
          attrs?.tenant_subject === "acme" && attrs?.tenant_payload === "globex"
        );
      },
    );
    expect(crossTenantCalls.length).toBe(1);
    expect(crossTenantCalls[0]?.[0]).toBe(1);

    crossSpy.mockRestore();
    await service.onModuleDestroy();
  });

  it("malformed JSON envelope → PermanentError(parse_error) (REQ-ASIS-003)", async () => {
    const { service, repo } = await buildService({ mode: "worker" });
    const cap = captured(service);

    const subject = buildRegistryPlatformSubject("acme", "service", "upserted");
    const msg = makeJsMsg(subject, "{not-json");

    let caught: unknown = null;
    try {
      await cap.handler(msg);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PermanentError);
    expect((caught as PermanentError).reason).toBe("parse_error");
    expect(repo.upsertCalls.length).toBe(0);

    await service.onModuleDestroy();
  });

  it("unknown CloudEvents type → PermanentError(unknown_type) (REQ-ASIS-003)", async () => {
    const { service, repo } = await buildService({ mode: "worker" });
    const cap = captured(service);

    const subject = "evt.acme.registry-service.platform.service.system.upserted.v1";
    const envelope = buildEnvelope("acme", "io.foo.bar.v1", {
      serviceId: "svc-1",
      tenantId: "acme",
      name: "billing",
    });
    const msg = makeJsMsg(subject, envelope);

    let caught: unknown = null;
    try {
      await cap.handler(msg);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PermanentError);
    expect((caught as PermanentError).reason).toBe("unknown_type");
    expect(repo.upsertCalls.length).toBe(0);

    await service.onModuleDestroy();
  });

  it("transient repo Error propagates as plain Error (runner naks) (REQ-ASIS-003)", async () => {
    const { service, repo } = await buildService({ mode: "worker" });
    const cap = captured(service);

    repo.upsertMirror.mockImplementationOnce(() =>
      Promise.reject(new Error("connection reset")),
    );

    const subject = buildRegistryPlatformSubject("acme", "service", "upserted");
    const payload: IServiceConfigUpsertedPayload = {
      serviceId: "svc-1",
      tenantId: "acme",
      name: "billing",
      knativeName: "billing-svc",
      namespace: "tenant-acme",
      port: 8080,
      status: "active",
    };
    const msg = makeJsMsg(
      subject,
      buildEnvelope("acme", SERVICE_UPSERTED_EVENT_TYPE, payload),
    );

    let caught: unknown = null;
    try {
      await cap.handler(msg);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(PermanentError);
    expect((caught as Error).message).toBe("connection reset");

    await service.onModuleDestroy();
  });
});

/**
 * `MultiTenantConsumerManager.prototype` is process-global and bun runs
 * every spec file inside ONE process — leaving the lifecycle stubs
 * installed silently disables `start()`/`stop()` for the docker
 * integration specs loaded afterwards, which then time out waiting for
 * deliveries that never happen. Restore the real methods once this
 * file's suites are done.
 */
afterAll(() => {
  startSpy.mockRestore();
  stopSpy.mockRestore();
});
