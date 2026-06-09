import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { SchedulerModule } from "./modules/scheduler/scheduler.module";
import { HeartbeatModule } from "./modules/heartbeat/heartbeat.module";
import { HealthModule } from "./modules/health/health.module";
import { AdminModule } from "./modules/admin/admin.module";

@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "agent-scheduler-service" }),
    ProvidersModule,
    SchedulerModule,
    HeartbeatModule,
    HealthModule,
    AdminModule,
  ],
})
export class AppModule {}
