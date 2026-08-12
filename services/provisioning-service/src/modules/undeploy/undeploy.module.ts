// Undeploy module (PENDIENTES/12-undeploy.spec.md T01) — mirrors
// `ApplyModule`'s wiring: it consumes what already exists
// (`MANIFEST_REVISION_REPOSITORY` from ManifestsModule, the read clients
// `PLATFORM_RESOURCE_CLIENTS` exported by PlanModule, `SecretsService` from
// SecretsModule) and adds only the delete clients.
//
// The two TEARDOWN repository tokens are provided HERE, not in the modules
// that own their tables: `ManifestsModule`/`KbModule` are imported by
// Plan/Apply, whose isolated DI-wiring specs compile those modules without a
// tenant-connection provider. Declaring the teardown providers next to their
// only consumer keeps those graphs untouched (see
// `manifests/domain/manifest-teardown.repository.interface.ts`).

import { Module } from "@nestjs/common";
import { KB_CHECKSUM_TEARDOWN_REPOSITORY } from "../kb/domain/kb-checksum-teardown.repository.interface";
import { KbChecksumPostgresRepository } from "../kb/infrastructure/kb-checksum.postgres.repository";
import { MANIFEST_TEARDOWN_REPOSITORY } from "../manifests/domain/manifest-teardown.repository.interface";
import { ManifestRevisionPostgresRepository } from "../manifests/infrastructure/manifest-revision.postgres.repository";
import { ManifestsModule } from "../manifests/manifests.module";
import type { PlatformResourceClients } from "../plan/domain/platform-resource-client.interface";
import { PLATFORM_RESOURCE_CLIENTS } from "../plan/domain/platform-resource-client.interface";
import { PlanModule } from "../plan/plan.module";
import { SecretsModule } from "../secrets/secrets.module";
import { PLATFORM_RESOURCE_DELETERS } from "./domain/platform-resource-deleter.interface";
import { buildPlatformResourceDeleters } from "./infrastructure/platform-resource-deleters.provider";
import { UndeployController } from "./undeploy.controller";
import { UndeployService } from "./undeploy.service";

@Module({
  imports: [ManifestsModule, PlanModule, SecretsModule],
  providers: [
    UndeployService,
    {
      provide: MANIFEST_TEARDOWN_REPOSITORY,
      useClass: ManifestRevisionPostgresRepository,
    },
    {
      provide: KB_CHECKSUM_TEARDOWN_REPOSITORY,
      useClass: KbChecksumPostgresRepository,
    },
    {
      // Reuses the SAME read clients the planner/apply use for the
      // find-by-name lookup half of every delete.
      provide: PLATFORM_RESOURCE_DELETERS,
      useFactory: (clients: PlatformResourceClients) =>
        buildPlatformResourceDeleters(clients),
      inject: [PLATFORM_RESOURCE_CLIENTS],
    },
  ],
  controllers: [UndeployController],
  exports: [UndeployService],
})
export class UndeployModule {}
