import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { NatsPublisher, lazyNatsProvider } from "./providers/nats.provider";
import { ProvidersModule } from "./providers/providers.module";
import { HealthModule } from "./modules/health/health.module";
import { MemoryModule } from "./modules/memory/memory.module";
import { AgentToolsModule } from "./modules/agent-tools/agent-tools.module";

@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "agent-memory-service" }),
    ProvidersModule,
    HealthModule,
    MemoryModule,
    AgentToolsModule,
  ],
  providers: [lazyNatsProvider, NatsPublisher],
  exports: [NatsPublisher],
})
export class AppModule {}
