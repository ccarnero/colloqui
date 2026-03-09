import { Global, Module } from '@nestjs/common';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_CLIENT,
  natsProvider,
  jetStreamManagerProvider,
  jetStreamClientProvider,
} from './providers/nats.provider';
import { TenantConnectionManager } from './providers/tenant-connection-manager';

@Global()
@Module({
  imports: [AuditModule, HealthModule],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamClientProvider,
    TenantConnectionManager,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_CLIENT,
    TenantConnectionManager,
  ],
})
export class AppModule {}
