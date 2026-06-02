import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Client } from "@temporalio/client";
import type { NatsConnection } from "nats";
import { NATS_CONNECTION } from "@yoizen/database";
import { HealthController } from "../../src/modules/health/health.controller";
import { TEMPORAL_CLIENT } from "../../src/providers/temporal.provider";
import { WorkflowTenantConnectionManager } from "../../src/providers/tenant-connection-manager";

describe("HealthController", () => {
  let controller: HealthController;
  let mockTemporal: {
    workflowService: { getSystemInfo: ReturnType<typeof mock> };
  };
  let mockNats: { isClosed: () => boolean };
  let verifyConnectivity: ReturnType<typeof mock>;
  let previousDbEngine: string | undefined;

  beforeEach(async () => {
    previousDbEngine = process.env.DB_ENGINE;
    process.env.DB_ENGINE = "mongo";

    mockTemporal = {
      workflowService: {
        getSystemInfo: mock(() => Promise.resolve({})),
      },
    };
    mockNats = { isClosed: () => false };
    verifyConnectivity = mock(() => Promise.resolve(true));

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: TEMPORAL_CLIENT,
          useValue: mockTemporal as unknown as Client,
        },
        {
          provide: NATS_CONNECTION,
          useValue: mockNats as unknown as NatsConnection,
        },
        {
          provide: WorkflowTenantConnectionManager,
          useValue: {
            verifyConnectivity,
          } as unknown as WorkflowTenantConnectionManager,
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

  it("returns ok when Temporal, NATS, and Mongo are healthy", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.temporal).toBe(true);
    expect(result.nats).toBe(true);
    expect(result.mongo).toBe(true);
  });

  it("returns degraded when Temporal fails", async () => {
    mockTemporal.workflowService.getSystemInfo.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.temporal).toBe(false);
  });

  it("returns degraded when any tenant Mongo pool is unreachable", async () => {
    verifyConnectivity.mockResolvedValueOnce(false);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.mongo).toBe(false);
  });
});
