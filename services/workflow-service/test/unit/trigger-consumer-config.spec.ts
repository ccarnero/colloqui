import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";

/**
 * Captures the `IMultiTenantConsumerConfig` passed to the manager
 * constructor so we can assert the post-mortem-driven knobs survive
 * future edits. See `post-mortem/POST-MORTEM.md` §P1.1.
 */
type CapturedConfig = {
  runnerOptions?: { concurrency?: number };
  maxDeliver?: number;
  ackWaitMs?: number;
  backoffMs?: readonly number[];
  durableName?: string;
  filterSubject?: string;
};

const capturedConfigs: CapturedConfig[] = [];
const ORIGINAL_TRIGGER_CONCURRENCY = process.env.WORKFLOW_TRIGGER_CONCURRENCY;

mock.module("nats", () => ({
  headers: () => new Map<string, string>(),
}));

class FakeMultiTenantConsumerManager {
  constructor(
    _jsm: unknown,
    _js: unknown,
    config: CapturedConfig,
    _handler: unknown,
    _logger: unknown,
  ) {
    capturedConfigs.push(config);
  }
  start = mock(() => Promise.resolve());
  stop = mock(() => Promise.resolve());
}

/**
 * Mock surface area must cover EVERY symbol the import graph rooted
 * at `trigger-consumer.service.ts` pulls from `@yoizen/database`
 * (transitively via `providers.module.ts`). Anything missing surfaces
 * as a `SyntaxError: Export named 'X' not found` at load time.
 */
mock.module("@yoizen/database", () => ({
  MultiTenantConsumerManager: FakeMultiTenantConsumerManager,
  NATS_CONNECTION: Symbol.for("NATS_CONNECTION"),
  createNatsConnectionProvider: (_name: string) => ({
    provide: Symbol.for("NATS_CONNECTION"),
    useFactory: () => ({}),
  }),
  TenantConnectionManager: class {},
  TenantDeletionEvictionListener: class {},
}));

/**
 * `@yoizen/observability` is re-exported through providers.module
 * and pulls in OTEL helpers (tracedFetch, span builders, etc.). We
 * pass through every original export and only override the few
 * symbols the trigger-consumer service touches directly so the rest
 * of the import graph keeps loading cleanly.
 */
const realObservability = await import("@yoizen/observability");
mock.module("@yoizen/observability", () => ({
  ...realObservability,
  PinoLoggerService: class {
    log = mock();
    warn = mock();
    error = mock();
    debug = mock();
  },
  createNatsConsumerMetrics: () => ({}),
  isWorkerMode: () => true,
  resolveServiceName: (name: string) => name,
}));

const { TriggerConsumerService } = await import(
  "../../src/modules/triggers/trigger-consumer.service"
);

describe("TriggerConsumerService — post-mortem config knobs (POST-MORTEM §P1.1)", () => {
  beforeEach(() => {
    capturedConfigs.length = 0;
    if (ORIGINAL_TRIGGER_CONCURRENCY === undefined) {
      delete process.env.WORKFLOW_TRIGGER_CONCURRENCY;
    } else {
      process.env.WORKFLOW_TRIGGER_CONCURRENCY = ORIGINAL_TRIGGER_CONCURRENCY;
    }
  });

  async function bootService(): Promise<void> {
    const service = new TriggerConsumerService(
      {} as never,
      {} as never,
      { executeWorkflow: mock(() => Promise.resolve({})) } as never,
      { findDefinitionsByTriggerType: mock(() => Promise.resolve([])) } as never,
    );
    await service.onModuleInit();
  }

  it("defaults runnerOptions.concurrency to 2 to protect Temporal during backlog drain", async () => {
    await bootService();
    expect(capturedConfigs).toHaveLength(1);
    expect(capturedConfigs[0]?.runnerOptions?.concurrency).toBe(2);
  });

  it("allows WORKFLOW_TRIGGER_CONCURRENCY to tune trigger pressure without rebuilding", async () => {
    process.env.WORKFLOW_TRIGGER_CONCURRENCY = "4";
    await bootService();
    expect(capturedConfigs[0]?.runnerOptions?.concurrency).toBe(4);
  });

  it("uses ackWaitMs: 60_000 (was 30_000 before post-mortem)", async () => {
    await bootService();
    expect(capturedConfigs[0]?.ackWaitMs).toBe(60_000);
  });

  it("uses backoffMs: [60_000, 120_000] — aligned with ackWaitMs per NATS rewrite rule", async () => {
    await bootService();
    expect(capturedConfigs[0]?.backoffMs).toEqual([60_000, 120_000]);
  });

  it("backoff[0] equals ackWaitMs (NATS overrides ack_wait with backoff[0])", async () => {
    await bootService();
    const config = capturedConfigs[0];
    expect(config?.backoffMs?.[0]).toBe(config?.ackWaitMs);
  });

  it("preserves maxDeliver: 3 (must remain > backoff.length)", async () => {
    await bootService();
    const config = capturedConfigs[0];
    expect(config?.maxDeliver).toBe(3);
    expect(config?.maxDeliver).toBeGreaterThan(config?.backoffMs?.length ?? 0);
  });

  it("keeps durable name + filter subject stable across the config rewrite", async () => {
    await bootService();
    expect(capturedConfigs[0]?.durableName).toBe("workflow-triggers");
    expect(capturedConfigs[0]?.filterSubject).toMatch(/^evt\..+received\.v1$/);
  });
});
