import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { AuditModule } from "./modules/audit/audit.module";
import { GatewayAuditModule } from "./modules/gateway-audit/gateway-audit.module";
import { ChannelAuditModule } from "./modules/channel-audit/channel-audit.module";
import { HealthModule } from "./modules/health/health.module";
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  GATEWAY_AUDIT_CONSUMER,
  natsProvider,
  jetStreamManagerProvider,
  gatewayAuditConsumerProvider,
} from "./providers/nats.provider";
import { TenantConnectionManager } from "@yoizen/database";

/** Registers NATS and tenant DB access as global providers for audit feature modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "audit-service" }),
    AuditModule,
    GatewayAuditModule,
    ChannelAuditModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    gatewayAuditConsumerProvider,
    TenantConnectionManager,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    GATEWAY_AUDIT_CONSUMER,
    TenantConnectionManager,
  ],
})
export class AppModule {}
