import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { NatsConnection } from "nats";
import { NATS_CONNECTION } from "@yoizen/database";
import { HealthController } from "../../src/modules/health/health.controller";
import { AdapterTenantConnectionManager } from "../../src/providers/tenant-connection-manager";

describe("HealthController", () => {
  let controller: HealthController;
  let mockNats: { isClosed: () => boolean };
  let verifyConnectivity: ReturnType<typeof mock>;

  beforeEach(async () => {
    mockNats = { isClosed: () => false };
    verifyConnectivity = mock(() => Promise.resolve(true));

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: NATS_CONNECTION,
          useValue: mockNats as unknown as NatsConnection,
        },
        {
          provide: AdapterTenantConnectionManager,
          useValue: {
            verifyConnectivity,
          } as unknown as AdapterTenantConnectionManager,
        },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it("returns ok when NATS and per-tenant Postgres are healthy", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.nats).toBe(true);
    expect(result.postgres).toBe(true);
  });

  it("returns degraded when NATS connection is closed", async () => {
    mockNats = { isClosed: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: NATS_CONNECTION,
          useValue: mockNats as unknown as NatsConnection,
        },
        {
          provide: AdapterTenantConnectionManager,
          useValue: {
            verifyConnectivity,
          } as unknown as AdapterTenantConnectionManager,
        },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);

    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe(false);
  });

  it("returns degraded when any tenant Postgres pool is unreachable", async () => {
    verifyConnectivity.mockResolvedValueOnce(false);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.postgres).toBe(false);
  });
});
