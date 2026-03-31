import { Global, Module } from '@nestjs/common';
import { ObservabilityModule } from '@yoizen/observability';
import { TenantConnectionManager } from './providers/tenant-connection-manager';
import { SeedService } from './db/seed.service';
import {
  SEED_SERVICE,
  TENANT_CONNECTION_MANAGER,
} from './providers/provider-tokens';
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_CLIENT,
  NatsPublisher,
  natsProvider,
  jetStreamManagerProvider,
  jetStreamClientProvider,
} from './providers/nats.provider';
import { AgentsModule } from './modules/agents/agents.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ConfigFilesModule } from './modules/config-files/config-files.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { HealthModule } from './modules/health/health.module';

@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: 'yoizenclaw-admin-service' }),
    AgentsModule,
    CredentialsModule,
    JobsModule,
    ConfigFilesModule,
    RuntimeModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamClientProvider,
    TenantConnectionManager,
    {
      provide: TENANT_CONNECTION_MANAGER,
      useExisting: TenantConnectionManager,
    },
    SeedService,
    {
      provide: SEED_SERVICE,
      useExisting: SeedService,
    },
    NatsPublisher,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_CLIENT,
    TENANT_CONNECTION_MANAGER,
    TenantConnectionManager,
    SEED_SERVICE,
    SeedService,
    NatsPublisher,
  ],
})
export class AppModule {}
