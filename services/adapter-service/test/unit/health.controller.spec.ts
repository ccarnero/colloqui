import "reflect-metadata";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type { NatsConnection } from "nats";
import { NATS_CONNECTION } from "@yoizen/database";
import { __resetServiceModeCacheForTests } from "@yoizen/observability";
import { HealthController } from "../../src/modules/health/health.controller";
import {
  HealthService,
  __resetShutdownFlagForTests,
  markShuttingDown,
} from "../../src/modules/health/health.service";
import { AdapterTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { InternalSyncService } from "../../src/modules/internal-sync/internal-sync.service";

interface ITestHarness {
  readonly controller: HealthController;
  readonly nats: { isClosed: () => boolean };
  readonly tenantConnections: { verifyConnectivity: ReturnType<typeof mock> };
  readonly internalSync: { getRunnerHealthSnapshot: ReturnType<typeof mock> };
  readonly reply: {
    status: ReturnType<typeof mock>;
    statusCode: number | null;
  };
}

interface IHarnessOptions {
  readonly mode?: "api" | "worker";
  readonly natsClosed?: boolean;
  readonly dbHealthy?: boolean;
  readonly runnerHealth?: readonly { stream: string; healthy: boolean }[];
}

function setMode(mode: "api" | "worker"): void {
  process.env.SERVICE_MODE = mode;
  __resetServiceModeCacheForTests();
}

async function buildHarness(opts: IHarnessOptions = {}): Promise<ITestHarness> {
  setMode(opts.mode ?? "worker");
  __resetShutdownFlagForTests();

  const natsClosed = opts.natsClosed ?? false;
  const dbHealthy = opts.dbHealthy ?? true;
  const runnerHealth = opts.runnerHealth ?? [
    { stream: "INGRESS-acme", healthy: true },
  ];

  const nats = { isClosed: () => natsClosed };
  const verifyConnectivity = mock(() => Promise.resolve(dbHealthy));
  const tenantConnections = { verifyConnectivity };
  const getRunnerHealthSnapshot = mock(() => runnerHealth);
  const internalSync = { getRunnerHealthSnapshot };

  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      HealthService,
      {
        provide: NATS_CONNECTION,
        useValue: nats as unknown as NatsConnection,
      },
      {
        provide: AdapterTenantConnectionManager,
        useValue: tenantConnections as unknown as AdapterTenantConnectionManager,
      },
      {
        provide: InternalSyncService,
        useValue: internalSync as unknown as InternalSyncService,
      },
    ],
  }).compile();

  const controller = moduleRef.get(HealthController);

  const statusSpy = mock((_code: number) => reply);
  const reply: { status: ReturnType<typeof mock>; statusCode: number | null } = {
    status: statusSpy,
    statusCode: null,
  };
  // capture the most-recent status code for assertions
  statusSpy.mockImplementation((code: number) => {
    reply.statusCode = code;
    return reply;
  });

  return {
    controller,
    nats,
    tenantConnections,
    internalSync,
    reply,
  };
}

describe("HealthController — /healthz (liveness, REQ-AST-003)", () => {
  afterAll(() => {
    delete process.env.SERVICE_MODE;
    __resetServiceModeCacheForTests();
    __resetShutdownFlagForTests();
  });

  afterEach(() => {
    __resetShutdownFlagForTests();
  });

  it("returns ok in api mode regardless of dependencies", async () => {
    const { controller } = await buildHarness({
      mode: "api",
      natsClosed: true,
      dbHealthy: false,
    });
    expect(controller.liveness()).toEqual({ status: "ok" });
  });

  it("returns ok in worker mode regardless of dependencies", async () => {
    const { controller } = await buildHarness({
      mode: "worker",
      natsClosed: true,
      dbHealthy: false,
      runnerHealth: [],
    });
    expect(controller.liveness()).toEqual({ status: "ok" });
  });
});

describe("HealthController — worker /readyz (REQ-AST-004)", () => {
  beforeEach(() => {
    __resetShutdownFlagForTests();
  });

  afterAll(() => {
    delete process.env.SERVICE_MODE;
    __resetServiceModeCacheForTests();
    __resetShutdownFlagForTests();
  });

  it("returns 503 when NATS is disconnected (REQ-AST-004 NATS gate)", async () => {
    const { controller, reply } = await buildHarness({
      mode: "worker",
      natsClosed: true,
      dbHealthy: true,
      runnerHealth: [{ stream: "INGRESS-acme", healthy: true }],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBe(503);
    expect(result.status).toBe("fail");
    expect(result.mode).toBe("worker");
    expect(result.failed).toContain("nats");
    expect(result.failed).not.toContain("db");
    expect(result.failed).not.toContain("durables");
  });

  it("returns 503 when DB ping fails (REQ-AST-004 DB gate)", async () => {
    const { controller, reply } = await buildHarness({
      mode: "worker",
      natsClosed: false,
      dbHealthy: false,
      runnerHealth: [{ stream: "INGRESS-acme", healthy: true }],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBe(503);
    expect(result.status).toBe("fail");
    expect(result.failed).toContain("db");
    expect(result.failed).not.toContain("nats");
    expect(result.failed).not.toContain("durables");
  });

  it("returns 503 when zero runners report healthy (REQ-AST-004 durable gate)", async () => {
    const { controller, reply } = await buildHarness({
      mode: "worker",
      natsClosed: false,
      dbHealthy: true,
      runnerHealth: [
        { stream: "INGRESS-acme", healthy: false },
        { stream: "INGRESS-globex", healthy: false },
      ],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBe(503);
    expect(result.failed).toContain("durables");
    expect(result.failed).not.toContain("nats");
    expect(result.failed).not.toContain("db");
  });

  it("returns 503 with no bound streams at all (durable gate)", async () => {
    const { controller, reply } = await buildHarness({
      mode: "worker",
      runnerHealth: [],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBe(503);
    expect(result.failed).toContain("durables");
  });

  it("returns 200 when all three gates are green", async () => {
    const { controller, reply } = await buildHarness({
      mode: "worker",
      natsClosed: false,
      dbHealthy: true,
      runnerHealth: [
        { stream: "INGRESS-acme", healthy: true },
        { stream: "INGRESS-globex", healthy: false },
      ],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBeNull();
    expect(result.status).toBe("ok");
    expect(result.mode).toBe("worker");
    expect(result.failed).toEqual([]);
  });

  it("aggregates every failing gate at once (machine-readable body)", async () => {
    const { controller, reply } = await buildHarness({
      mode: "worker",
      natsClosed: true,
      dbHealthy: false,
      runnerHealth: [{ stream: "INGRESS-acme", healthy: false }],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBe(503);
    expect(result.failed).toEqual(["nats", "db", "durables"]);
  });
});

describe("HealthController — api /readyz (REQ-AST-005)", () => {
  beforeEach(() => {
    __resetShutdownFlagForTests();
  });

  afterAll(() => {
    delete process.env.SERVICE_MODE;
    __resetServiceModeCacheForTests();
    __resetShutdownFlagForTests();
  });

  it("returns 200 with NATS down (api MUST NOT depend on NATS)", async () => {
    const { controller, reply } = await buildHarness({
      mode: "api",
      natsClosed: true,
      dbHealthy: true,
      runnerHealth: [],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBeNull();
    expect(result.status).toBe("ok");
    expect(result.mode).toBe("api");
    expect(result.failed).toEqual([]);
  });

  it("returns 200 even when worker is at 0 replicas (no durables anywhere)", async () => {
    const { controller, reply } = await buildHarness({
      mode: "api",
      natsClosed: false,
      dbHealthy: true,
      runnerHealth: [
        { stream: "INGRESS-acme", healthy: false },
        { stream: "INGRESS-globex", healthy: false },
      ],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBeNull();
    expect(result.status).toBe("ok");
    expect(result.failed).toEqual([]);
  });

  it("returns 503 only when DB is the failing gate", async () => {
    const { controller, reply } = await buildHarness({
      mode: "api",
      natsClosed: false,
      dbHealthy: false,
      runnerHealth: [{ stream: "INGRESS-acme", healthy: true }],
    });

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBe(503);
    expect(result.failed).toEqual(["db"]);
  });
});

describe("HealthController — SIGTERM drain (REQ-AST-003)", () => {
  beforeEach(() => {
    __resetShutdownFlagForTests();
  });

  afterAll(() => {
    delete process.env.SERVICE_MODE;
    __resetServiceModeCacheForTests();
    __resetShutdownFlagForTests();
  });

  it("worker /readyz returns 503 once SIGTERM is received", async () => {
    const { controller, reply } = await buildHarness({
      mode: "worker",
      natsClosed: false,
      dbHealthy: true,
      runnerHealth: [{ stream: "INGRESS-acme", healthy: true }],
    });

    markShuttingDown();

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBe(503);
    expect(result.status).toBe("fail");
    expect(result.failed).toEqual(["shutting_down"]);
  });

  it("api /readyz returns 503 once SIGTERM is received", async () => {
    const { controller, reply } = await buildHarness({
      mode: "api",
      natsClosed: false,
      dbHealthy: true,
      runnerHealth: [],
    });

    markShuttingDown();

    const result = await controller.readiness(
      reply as unknown as Parameters<typeof controller.readiness>[0],
    );

    expect(reply.statusCode).toBe(503);
    expect(result.failed).toEqual(["shutting_down"]);
  });

  it("/healthz stays 200 during shutdown (liveness MUST NOT flip)", async () => {
    const { controller } = await buildHarness({ mode: "worker" });
    markShuttingDown();
    expect(controller.liveness()).toEqual({ status: "ok" });
  });
});

describe("HealthController — legacy /health endpoint (backwards-compat)", () => {
  afterAll(() => {
    delete process.env.SERVICE_MODE;
    __resetServiceModeCacheForTests();
    __resetShutdownFlagForTests();
  });

  it("returns ok aggregate when NATS and DB are healthy", async () => {
    const { controller } = await buildHarness({
      mode: "api",
      natsClosed: false,
      dbHealthy: true,
    });

    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.nats).toBe(true);
    expect(result.postgres).toBe(true);
  });

  it("returns degraded when NATS connection is closed", async () => {
    const { controller } = await buildHarness({
      mode: "api",
      natsClosed: true,
      dbHealthy: true,
    });

    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe(false);
  });

  it("returns degraded when per-tenant Postgres is unreachable", async () => {
    const { controller } = await buildHarness({
      mode: "api",
      natsClosed: false,
      dbHealthy: false,
    });

    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.postgres).toBe(false);
  });
});
