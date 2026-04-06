import { Global, Module } from '@nestjs/common';
import { ObservabilityModule } from '@yoizen/observability';
import { TenantConnectionManager } from './providers/tenant-connection-manager';
import {
  TENANT_CONNECTION_MANAGER,
} from './providers/provider-tokens';
import {
  LAZY_NATS,
  NatsPublisher,
  lazyNatsProvider,
} from './providers/nats.provider';
import { AgentsModule } from './modules/agents/agents.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ConfigFilesModule } from './modules/config-files/config-files.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { HealthModule } from './modules/health/health.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AdaptersModule } from './modules/adapters/adapters.module';
import { MemoriesModule } from './modules/memories/memories.module';

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
    TemplatesModule,
    AdaptersModule,
    MemoriesModule,
  ],
  providers: [
    lazyNatsProvider,
    TenantConnectionManager,
    {
      provide: TENANT_CONNECTION_MANAGER,
      useExisting: TenantConnectionManager,
    },
    NatsPublisher,
  ],
  exports: [
    LAZY_NATS,
    TENANT_CONNECTION_MANAGER,
    TenantConnectionManager,
    NatsPublisher,
  ],
})
export class AppModule {}
