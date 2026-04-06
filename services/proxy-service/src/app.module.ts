import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ProxyModule } from "./modules/proxy/proxy.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "proxy-service" }),
    ProxyModule,
    HealthModule,
  ],
})
export class AppModule {}
