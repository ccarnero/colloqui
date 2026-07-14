import { Module } from "@nestjs/common";
import { MANIFEST_REVISION_REPOSITORY } from "./domain/manifest-revision.repository.interface";
import { ManifestRevisionPostgresRepository } from "./infrastructure/manifest-revision.postgres.repository";
import { ManifestsController } from "./manifests.controller";
import { ManifestsService } from "./manifests.service";

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
