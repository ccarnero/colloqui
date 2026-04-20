import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { PostgresModule } from "./providers/postgres.provider";
import { AdaptersModule } from "./modules/adapters/adapters.module";
import { HealthModule } from "./modules/health/health.module";
import { InternalSyncModule } from "./modules/internal-sync/internal-sync.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "adapter-service" }),
    PostgresModule,
    AdaptersModule,
    InternalSyncModule,
    HealthModule,
  ],
})
export class AppModule {}
