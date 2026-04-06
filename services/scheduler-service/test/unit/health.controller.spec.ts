import { describe, it, expect, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { TenantConnectionManager } from "../../src/providers/tenant-connection-manager";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: TenantConnectionManager,
          useValue: {
            verifyConnectivity: () => Promise.resolve(true),
          },
        },
      ],
    }).compile();
    controller = module.get(HealthController);
  });

  it("returns ok when postgres connectivity verifies", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.postgres).toBe(true);
  });
});
