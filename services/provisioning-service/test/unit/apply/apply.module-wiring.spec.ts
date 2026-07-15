import "../../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ApplyModule } from "../../../src/modules/apply/apply.module";
import { ApplyService } from "../../../src/modules/apply/apply.service";
import { MANIFEST_REVISION_REPOSITORY } from "../../../src/modules/manifests/domain/manifest-revision.repository.interface";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
} from "../../../src/providers/nats.provider";

// Regression test: a Nest DI wiring bug found during T04 — `PlanModule`
// (imported by `ApplyModule`) provided `PLATFORM_RESOURCE_CLIENTS` but did
// NOT export it, so `ApplyService`'s constructor injection of that token
// would fail to resolve at runtime (a bug tsc/bun test cannot catch by
// themselves, since Nest DI tokens are not statically typed). This test
// actually COMPILES the module graph via `Test.createTestingModule`, only
// overriding the providers that would otherwise need a real Postgres/NATS
// connection at construction time.
describe("ApplyModule — DI wiring compiles end to end", () => {
  it("resolves ApplyService with every constructor dependency satisfied", async () => {
    const fakeRepository = {
      getLatest: async () => null,
      createRevision: async () => {
        throw new Error("not used in this wiring test");
      },
    };
    const fakeJs = { publish: mock(() => Promise.resolve({})) };
    const fakeJsm = {
      streams: {
        add: mock(() => Promise.resolve({})),
        info: mock(() => Promise.reject(new Error("n/a"))),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [ApplyModule],
    })
      .overrideProvider(MANIFEST_REVISION_REPOSITORY)
      .useValue(fakeRepository)
      .overrideProvider(NATS_CONNECTION)
      .useValue({})
      .overrideProvider(JETSTREAM)
      .useValue(fakeJs)
      .overrideProvider(JETSTREAM_MANAGER)
      .useValue(fakeJsm)
      .compile();

    const service = moduleRef.get(ApplyService);
    expect(service).toBeInstanceOf(ApplyService);

    const result = await service.apply("tenant-a", "missing");
    expect(result.ok).toBe(false);
  });
});
