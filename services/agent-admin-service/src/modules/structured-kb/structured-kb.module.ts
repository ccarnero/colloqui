import { Module } from "@nestjs/common";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { JobTrackingService } from "../knowledge-bases/job-tracking.service";
import { SKBContainersController } from "./containers.controller";
import { SKBContainersRepository } from "./skb-containers.repository";
import { SKBContainersService } from "./skb-containers.service";
import { SKBFileParser } from "./skb-file-parser";
import { SKBIngestionWatchdogService } from "./skb-ingestion-watchdog.service";
import { SKBIngestionWorkerService } from "./skb-ingestion-worker.service";
import { SKBQueryService } from "./skb-query.service";
import { SKBQueryHistoryRepository } from "./skb-query-history.repository";
import { SKBQueryHistoryService } from "./skb-query-history.service";
import { SKBRateLimitGuard } from "./skb-rate-limit.guard";
import { SKBRowIndexService } from "./skb-row-index.service";
import { SKBRowsRepository } from "./skb-rows.repository";
import { SKBSchemaRepository } from "./skb-schema.repository";
import { SKBSchemaAnalyzerService } from "./skb-schema-analyzer.service";
import { StructuredKBController } from "./structured-kb.controller";

@Module({
  controllers: [SKBContainersController, StructuredKBController],
  providers: [
    SKBContainersService,
    SKBContainersRepository,
    SKBFileParser,
    SKBSchemaAnalyzerService,
    SKBRowsRepository,
    SKBSchemaRepository,
    SKBQueryService,
    SKBIngestionWorkerService,
    SKBIngestionWatchdogService,
    SKBQueryHistoryService,
    SKBQueryHistoryRepository,
    SKBRowIndexService,
    JobTrackingService,
    SKBRateLimitGuard,
    // String-token providers for services that use @Inject("...")
    { provide: "SKBSchemaRepository", useExisting: SKBSchemaRepository },
    { provide: "SKBRowsRepository", useExisting: SKBRowsRepository },
    { provide: "SKBQueryHistoryService", useExisting: SKBQueryHistoryService },
    { provide: "SKBContainersService", useExisting: SKBContainersService },
    {
      provide: "TenantConnectionManager",
      useExisting: YoizenclawTenantConnectionManager,
    },
    {
      provide: "RowIndexSqlProvider",
      useExisting: YoizenclawTenantConnectionManager,
    },
  ],
  exports: [SKBContainersService, SKBQueryService, SKBRowIndexService],
})
export class StructuredKBModule {}
