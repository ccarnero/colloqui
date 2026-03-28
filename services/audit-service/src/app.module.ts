import { Global, Module } from '@nestjs/common';
import { ObservabilityModule } from '@yoizen/observability';
import { AuditModule } from './modules/audit/audit.module';
import { GatewayAuditModule } from './modules/gateway-audit/gateway-audit.module';
import { ChannelAuditModule } from './modules/channel-audit/channel-audit.module';
import { HealthModule } from './modules/health/health.module';
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_CLIENT,
  GATEWAY_AUDIT_CONSUMER,
  natsProvider,
  jetStreamManagerProvider,
  jetStreamClientProvider,
  gatewayAuditConsumerProvider,
} from './providers/nats.provider';
import { TenantConnectionManager } from './providers/tenant-connection-manager';

@Global()
@Module({
  imports: [ObservabilityModule.forRoot({ serviceName: 'audit-service' }), AuditModule, GatewayAuditModule, ChannelAuditModule, HealthModule],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamClientProvider,
    gatewayAuditConsumerProvider,
    TenantConnectionManager,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_CLIENT,
    GATEWAY_AUDIT_CONSUMER,
    TenantConnectionManager,
  ],
})
export class AppModule {}
