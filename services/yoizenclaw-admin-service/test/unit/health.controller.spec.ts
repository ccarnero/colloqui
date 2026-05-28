import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { HttpException } from "@nestjs/common";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { HealthController } from "../../src/modules/health/health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const tenantManager = {
      getKnownTenantIds: mock(() => []),
      probeFirstPool: mock(() => Promise.resolve(true)),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: YoizenclawTenantConnectionManager, useValue: tenantManager },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it("returns ok when probeFirstPool succeeds", async () => {
    const res = await controller.check();
    expect(res.status).toBe("ok");
    expect(res.checks.database).toBe("up");
  });

  it("throws HttpException 503 when probeFirstPool fails", async () => {
    const tenantManager = {
      getKnownTenantIds: mock(() => []),
      probeFirstPool: mock(() => Promise.resolve(false)),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: YoizenclawTenantConnectionManager, useValue: tenantManager },
      ],
    }).compile();
    const c = moduleRef.get(HealthController);
    await expect(c.check()).rejects.toBeInstanceOf(HttpException);
  });
});
