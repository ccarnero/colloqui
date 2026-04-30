import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { CacheModule } from "./modules/cache/cache.module";
import { HealthModule } from "./modules/health/health.module";
import { RedisModule } from "./redis.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "cache-service" }),
    RedisModule,
    CacheModule,
    HealthModule,
  ],
})
export class AppModule {}
