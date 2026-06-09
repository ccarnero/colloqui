import { Module } from "@nestjs/common";
import { SKBContainersController } from "./containers.controller";
import { StructuredKBController } from "./structured-kb.controller";
import { SKBContainersService } from "./skb-containers.service";
import { SKBContainersRepository } from "./skb-containers.repository";
import { SKBFileParser } from "./skb-file-parser";
import { SKBSchemaAnalyzerService } from "./skb-schema-analyzer.service";
import { SKBRowsRepository } from "./skb-rows.repository";
import { SKBSchemaRepository } from "./skb-schema.repository";
import { SKBQueryService } from "./skb-query.service";
import { SKBIngestionWorkerService } from "./skb-ingestion-worker.service";
import { SKBIngestionWatchdogService } from "./skb-ingestion-watchdog.service";
import { SKBQueryHistoryService } from "./skb-query-history.service";
import { SKBQueryHistoryRepository } from "./skb-query-history.repository";
import { SKBRowIndexService } from "./skb-row-index.service";
import { JobTrackingService } from "../knowledge-bases/job-tracking.service";
import { SKBRateLimitGuard } from "./skb-rate-limit.guard";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";

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
