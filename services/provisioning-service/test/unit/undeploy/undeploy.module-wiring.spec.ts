import "../../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { KB_CHECKSUM_TEARDOWN_REPOSITORY } from "../../../src/modules/kb/domain/kb-checksum-teardown.repository.interface";
import { MANIFEST_REVISION_REPOSITORY } from "../../../src/modules/manifests/domain/manifest-revision.repository.interface";
import { MANIFEST_TEARDOWN_REPOSITORY } from "../../../src/modules/manifests/domain/manifest-teardown.repository.interface";
import { PLATFORM_RESOURCE_DELETERS } from "../../../src/modules/undeploy/domain/platform-resource-deleter.interface";
import { UndeployModule } from "../../../src/modules/undeploy/undeploy.module";
import { UndeployService } from "../../../src/modules/undeploy/undeploy.service";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
} from "../../../src/providers/nats.provider";

// Same regression posture as `apply.module-wiring.spec.ts`: Nest DI tokens are
// not statically typed, so only compiling the real module graph proves
// `UndeployService`'s five constructor dependencies (two teardown
// repositories, the deleter map, the manifest repository and `SecretsService`
// from the imported `SecretsModule`) actually resolve at runtime.
describe("UndeployModule — DI wiring compiles end to end", () => {
  it("resolves UndeployService with every constructor dependency satisfied", async () => {
    const fakeRepository = {
      getLatest: async () => null,
      createRevision: async () => {
        throw new Error("not used in this wiring test");
      },
    };
    const fakeTeardown = {
      listLatestManifests: async () => [],
      deleteManifest: async () => 0,
    };
    const fakeChecksums = { deleteByManifest: async () => 0 };
    const fakeJs = { publish: mock(() => Promise.resolve({})) };
    const fakeJsm = {
      streams: {
        add: mock(() => Promise.resolve({})),
        info: mock(() => Promise.reject(new Error("n/a"))),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [UndeployModule],
    })
      .overrideProvider(MANIFEST_REVISION_REPOSITORY)
      .useValue(fakeRepository)
      .overrideProvider(MANIFEST_TEARDOWN_REPOSITORY)
      .useValue(fakeTeardown)
      .overrideProvider(KB_CHECKSUM_TEARDOWN_REPOSITORY)
      .useValue(fakeChecksums)
      .overrideProvider(NATS_CONNECTION)
      .useValue({})
      .overrideProvider(JETSTREAM)
      .useValue(fakeJs)
      .overrideProvider(JETSTREAM_MANAGER)
      .useValue(fakeJsm)
      .compile();

    const service = moduleRef.get(UndeployService);
    expect(service).toBeInstanceOf(UndeployService);

    const result = await service.undeploy("tenant-a", "missing");
    expect(result.ok).toBe(false);
  });

  it("wires a deleter for every resource kind a manifest can declare", async () => {
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
      imports: [UndeployModule],
    })
      .overrideProvider(MANIFEST_REVISION_REPOSITORY)
      .useValue(fakeRepository)
      .overrideProvider(MANIFEST_TEARDOWN_REPOSITORY)
      .useValue({
        listLatestManifests: async () => [],
        deleteManifest: async () => 0,
      })
      .overrideProvider(KB_CHECKSUM_TEARDOWN_REPOSITORY)
      .useValue({ deleteByManifest: async () => 0 })
      .overrideProvider(NATS_CONNECTION)
      .useValue({})
      .overrideProvider(JETSTREAM)
      .useValue(fakeJs)
      .overrideProvider(JETSTREAM_MANAGER)
      .useValue(fakeJsm)
      .compile();

    const deleters = moduleRef.get(PLATFORM_RESOURCE_DELETERS);
    // Every kind is wired today — no `skipped_no_delete_api` in production
    // (see `platform-resource-deleters.provider.ts`'s inventory).
    expect(Object.keys(deleters).sort()).toEqual([
      "agent",
      "channel",
      "connector",
      "knowledgeBase",
      "mcpServer",
      "service",
      "skill",
      "systemVariable",
      "workflow",
    ]);
  });
});
