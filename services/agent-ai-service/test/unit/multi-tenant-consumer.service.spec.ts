import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { IMultiTenantConsumerConfig } from "@yoizen/database";

// PinoLoggerService is a field initializer — must be mocked before import.
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

let capturedConfig: IMultiTenantConsumerConfig | undefined;
const mockManagerStart = mock(() => Promise.resolve());
const mockManagerStop = mock(() => Promise.resolve());

mock.module("@yoizen/database", () => ({
  MultiTenantConsumerManager: class MockMultiTenantConsumerManager {
    constructor(
      _jsm: unknown,
      _js: unknown,
      config: IMultiTenantConsumerConfig
    ) {
      capturedConfig = config;
    }
    start = mockManagerStart;
    stop = mockManagerStop;
  },
}));

import { MultiTenantConsumerService } from "../../src/modules/nats-consumer/multi-tenant-consumer.service";

/**
 * Covers ASYNC-RESILIENCE-AUDIT.md F1 — the multi-tenant durable consumer
 * must register with an ackWait window that comfortably exceeds
 * multi-minute `generateReply` handler runtime (900s default, overridable),
 * and must opt into periodic `msg.working()` via `runnerOptions`.
 */
describe("MultiTenantConsumerService — F1 consumer config", () => {
  let mockJsm: object;
  let mockJs: object;
  let mockMessageRouter: { route: ReturnType<typeof mock> };
  let originalAckWait: string | undefined;
  let originalWorkingInterval: string | undefined;

  beforeEach(() => {
    capturedConfig = undefined;
    mockManagerStart.mockClear();
    mockManagerStop.mockClear();
    mockJsm = {};
    mockJs = {};
    mockMessageRouter = { route: mock(() => Promise.resolve()) };
    originalAckWait = process.env.AGENT_AI_CONSUMER_ACK_WAIT_MS;
    originalWorkingInterval = process.env.AGENT_AI_CONSUMER_WORKING_INTERVAL_MS;
    delete process.env.AGENT_AI_CONSUMER_ACK_WAIT_MS;
    delete process.env.AGENT_AI_CONSUMER_WORKING_INTERVAL_MS;
  });

  afterEach(() => {
    if (originalAckWait === undefined) {
      delete process.env.AGENT_AI_CONSUMER_ACK_WAIT_MS;
    } else {
      process.env.AGENT_AI_CONSUMER_ACK_WAIT_MS = originalAckWait;
    }
    if (originalWorkingInterval === undefined) {
      delete process.env.AGENT_AI_CONSUMER_WORKING_INTERVAL_MS;
    } else {
      process.env.AGENT_AI_CONSUMER_WORKING_INTERVAL_MS =
        originalWorkingInterval;
    }
  });

  it("registers the durable consumer with ackWaitMs=900_000 by default", async () => {
    const service = new MultiTenantConsumerService(
      mockJsm as never,
      mockJs as never,
      mockMessageRouter as never
    );

    await service.onModuleInit();

    expect(capturedConfig?.ackWaitMs).toBe(900_000);
    await service.onModuleDestroy();
  });

  it("honors AGENT_AI_CONSUMER_ACK_WAIT_MS override", async () => {
    process.env.AGENT_AI_CONSUMER_ACK_WAIT_MS = "600000";
    const service = new MultiTenantConsumerService(
      mockJsm as never,
      mockJs as never,
      mockMessageRouter as never
    );

    await service.onModuleInit();

    expect(capturedConfig?.ackWaitMs).toBe(600_000);
    await service.onModuleDestroy();
  });

  it("configures the runner to call msg.working() via workingIntervalMs", async () => {
    const service = new MultiTenantConsumerService(
      mockJsm as never,
      mockJs as never,
      mockMessageRouter as never
    );

    await service.onModuleInit();

    expect(capturedConfig?.runnerOptions?.workingIntervalMs).toBe(30_000);
    await service.onModuleDestroy();
  });

  it("stops the manager on module destroy", async () => {
    const service = new MultiTenantConsumerService(
      mockJsm as never,
      mockJs as never,
      mockMessageRouter as never
    );

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(mockManagerStop).toHaveBeenCalledTimes(1);
  });
});
