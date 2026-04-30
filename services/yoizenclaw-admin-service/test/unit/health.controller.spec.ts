import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { HttpException } from "@nestjs/common";
import { TenantConnectionManager } from "@yoizen/database";
import { HealthController } from "../../src/modules/health/health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const tenantManager = {
      getPoolCount: mock(() => 0),
      probeFirstPool: mock(() => Promise.resolve(true)),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: TenantConnectionManager, useValue: tenantManager },
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
      getPoolCount: mock(() => 0),
      probeFirstPool: mock(() => Promise.resolve(false)),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: TenantConnectionManager, useValue: tenantManager },
      ],
    }).compile();
    const c = moduleRef.get(HealthController);
    let caught: unknown;
    try {
      await c.check();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    const httpEx = caught as HttpException;
    expect(httpEx.getStatus()).toBe(503);
    const body = httpEx.getResponse() as {
      status: string;
      checks: { database: string };
    };
    expect(body.status).toBe("error");
    expect(body.checks.database).toBe("down");
  });
});
