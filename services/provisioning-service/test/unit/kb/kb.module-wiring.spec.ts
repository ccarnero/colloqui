import "../../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { KB_RECONCILER } from "../../../src/modules/kb/domain/kb.interfaces";
import { KB_CHECKSUM_REPOSITORY } from "../../../src/modules/kb/domain/kb-checksum-repository.interface";
import { KbModule } from "../../../src/modules/kb/kb.module";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
} from "../../../src/providers/nats.provider";
import { ProvidersModule } from "../../../src/providers/providers.module";
import { ProvisioningTenantConnectionManager } from "../../../src/providers/tenant-connection-manager";

// Regression-style test mirroring `apply.module-wiring.spec.ts`'s rationale:
// `Test.createTestingModule` actually COMPILES the DI graph (useFactory /
// useExisting token chains are NOT statically checked by tsc), catching a
// wiring mistake tsc alone would miss.
describe("KbModule — DI wiring compiles end to end", () => {
  it("resolves both KB_CHECKSUM_REPOSITORY and KB_RECONCILER with every dependency satisfied", async () => {
    const fakeSql = async () => [];
    const fakeConnectionManager = {
      ensureSchema: mock(async () => fakeSql),
    };
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

    const moduleRef = await Test.createTestingModule({
      imports: [ProvidersModule, KbModule],
    })
      .overrideProvider(ProvisioningTenantConnectionManager)
      .useValue(fakeConnectionManager)
      .overrideProvider(NATS_CONNECTION)
      .useValue({})
      .overrideProvider(JETSTREAM)
      .useValue(fakeJs)
      .overrideProvider(JETSTREAM_MANAGER)
      .useValue(fakeJsm)
      .compile();

    expect(moduleRef.get(KB_CHECKSUM_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(KB_RECONCILER)).toBeDefined();
  });
});
