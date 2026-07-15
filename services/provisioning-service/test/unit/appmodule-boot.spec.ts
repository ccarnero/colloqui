import "../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { ApplyService } from "../../src/modules/apply/apply.service";
import { PlanService } from "../../src/modules/plan/plan.service";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
} from "../../src/providers/nats.provider";
import { ProvisioningTenantConnectionManager } from "../../src/providers/tenant-connection-manager";

// Regression test (T06 attempt 2): the isolated `kb.module-wiring` and
// `apply.module-wiring` specs each compile ONE module in isolation, so they
// could not surface a conflict that only appears when the FULL AppModule
// boots together — e.g. two modules each declaring the NATS connection
// providers, which opened duplicate connections at pod startup. This test
// compiles the entire AppModule graph (every module AppModule imports) with
// only the external NATS/Postgres edges mocked, catching pod-boot wiring
// failures before they reach the cluster.
describe("AppModule — full DI graph boots", () => {
  it("compiles every module together and resolves the key services", async () => {
    const fakeCM = { ensureSchema: mock(async () => async () => []) };
    const fakeJs = {
      publish: mock(() => Promise.resolve({})),
      views: { os: mock(() => Promise.resolve({})) },
    };
    const fakeJsm = {
      streams: {
        add: mock(() => Promise.resolve({})),
        info: mock(() => Promise.reject(new Error("n/a"))),
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NATS_CONNECTION)
      .useValue({})
      .overrideProvider(JETSTREAM)
      .useValue(fakeJs)
      .overrideProvider(JETSTREAM_MANAGER)
      .useValue(fakeJsm)
      .overrideProvider(ProvisioningTenantConnectionManager)
      .useValue(fakeCM)
      .compile();

    expect(moduleRef.get(PlanService)).toBeInstanceOf(PlanService);
    expect(moduleRef.get(ApplyService)).toBeInstanceOf(ApplyService);
  });
});
