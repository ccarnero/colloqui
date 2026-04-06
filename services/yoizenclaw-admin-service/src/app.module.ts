import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { TenantConnectionManager } from "@yoizen/database";
import {
  LAZY_NATS,
  NatsPublisher,
  lazyNatsProvider,
} from "./providers/nats.provider";
import { REDIS_CLIENT, redisProvider } from "./providers/redis.provider";
import { initYoizenClawTenantSchema } from "./providers/yoizenclaw-schema-initializer";
import { AgentsModule } from "./modules/agents/agents.module";
import { CredentialsModule } from "./modules/credentials/credentials.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { ConfigFilesModule } from "./modules/config-files/config-files.module";
import { RuntimeModule } from "./modules/runtime/runtime.module";
import { HealthModule } from "./modules/health/health.module";
import { TemplatesModule } from "./modules/templates/templates.module";
import { AdaptersModule } from "./modules/adapters/adapters.module";

function createYoizenClawTenantConnectionManager(): TenantConnectionManager {
  const tcm = new TenantConnectionManager();
  tcm.setSchemaInitializer(initYoizenClawTenantSchema);
  return tcm;
}

/** Registers lazy NATS and tenant DB manager as global providers for admin modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "yoizenclaw-admin-service" }),
    AgentsModule,
    CredentialsModule,
    JobsModule,
    ConfigFilesModule,
    RuntimeModule,
    HealthModule,
    TemplatesModule,
    AdaptersModule,
  ],
  providers: [
    lazyNatsProvider,
    redisProvider,
    {
      provide: TenantConnectionManager,
      useFactory: createYoizenClawTenantConnectionManager,
    },
    NatsPublisher,
  ],
  exports: [LAZY_NATS, REDIS_CLIENT, TenantConnectionManager, NatsPublisher],
})
export class AppModule {}
