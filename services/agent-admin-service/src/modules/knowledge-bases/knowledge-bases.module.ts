import { Module } from "@nestjs/common";
import { KnowledgeBasesController } from "./knowledge-bases.controller";
import { KnowledgeBasesService } from "./knowledge-bases.service";
import { DocumentsService } from "./documents.service";
import { DocumentsController } from "./documents.controller";
import { IngestionWorkerService } from "./ingestion-worker.service";
import { IngestionWatchdogService } from "./ingestion-watchdog.service";
import { CharacterChunker } from "./chunkers/character-chunker";
import { RecursiveChunker } from "./chunkers/recursive-chunker";
import { TitleSegmentationChunker } from "./chunkers/title-segmentation-chunker";
import { ChunkerRegistry } from "./chunkers/chunker-registry";
import { JobTrackingService } from "./job-tracking.service";
import { IngestionNotificationsService } from "./ingestion-notifications.service";

@Module({
  controllers: [KnowledgeBasesController, DocumentsController],
  providers: [
    KnowledgeBasesService,
    DocumentsService,
    IngestionWorkerService,
    IngestionWatchdogService,
    CharacterChunker,
    RecursiveChunker,
    TitleSegmentationChunker,
    ChunkerRegistry,
    JobTrackingService,
    IngestionNotificationsService,
  ],
  exports: [KnowledgeBasesService, DocumentsService],
})
export class KnowledgeBasesModule {}
