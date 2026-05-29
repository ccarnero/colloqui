import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { NatsConnection } from "nats";
import { HealthController } from "../../src/modules/health/health.controller";
import { NATS_CONNECTION } from "../../src/providers/nats.provider";
import { AuditTenantConnectionManager } from "../../src/providers/tenant-connection-manager";

describe("HealthController", () => {
  let controller: HealthController;
  let mockNc: { isClosed: ReturnType<typeof mock> };
  let mockTenantMgr: { verifyConnectivity: ReturnType<typeof mock> };
  let previousDbEngine: string | undefined;

  beforeEach(async () => {
    previousDbEngine = process.env.DB_ENGINE;
    process.env.DB_ENGINE = "mongo";

    mockNc = { isClosed: mock(() => false) };
    mockTenantMgr = {
      verifyConnectivity: mock(() => Promise.resolve(true)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: NATS_CONNECTION,
          useValue: mockNc as unknown as NatsConnection,
        },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
        },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  afterEach(() => {
    if (previousDbEngine === undefined) {
      delete process.env.DB_ENGINE;
    } else {
      process.env.DB_ENGINE = previousDbEngine;
    }
  });

  it("returns ok when NATS is open and mongo check passes", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.nats).toBe(true);
    expect(result.mongo).toBe(true);
  });

  it("returns fast readiness payload", () => {
    expect(controller.ready()).toEqual({ status: "ok" });
  });

  it("returns degraded when NATS connection is closed", async () => {
    mockNc.isClosed.mockReturnValue(true);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe(false);
    expect(result.mongo).toBe(true);
  });

  it("returns degraded when tenant mongo connectivity fails", async () => {
    mockTenantMgr.verifyConnectivity.mockResolvedValue(false);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe(true);
    expect(result.mongo).toBe(false);
  });
});
