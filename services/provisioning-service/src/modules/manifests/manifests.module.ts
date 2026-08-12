import { Module } from "@nestjs/common";
import { MANIFEST_REVISION_REPOSITORY } from "./domain/manifest-revision.repository.interface";
import { ManifestRevisionPostgresRepository } from "./infrastructure/manifest-revision.postgres.repository";
import { ManifestsController } from "./manifests.controller";
import { ManifestsService } from "./manifests.service";

// PENDIENTES/12-undeploy.spec.md T01 — the teardown-only port over the SAME
// table (`domain/manifest-teardown.repository.interface.ts`) is deliberately
// NOT provided here: this module is imported by Plan/Apply, whose isolated
// DI-wiring specs compile it WITHOUT the (global) tenant-connection provider
// and rely on `MANIFEST_REVISION_REPOSITORY` being the only Postgres-backed
// provider they must override. `UndeployModule` provides the teardown token
// itself, next to the only consumer.
@Module({
  providers: [
    ManifestsService,
    {
      provide: MANIFEST_REVISION_REPOSITORY,
      useClass: ManifestRevisionPostgresRepository,
    },
  ],
  controllers: [ManifestsController],
  exports: [MANIFEST_REVISION_REPOSITORY, ManifestsService],
})
export class ManifestsModule {}
