import { Module } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";
import { MetricsRepository } from "./metrics.repository";
import { MetricsService } from "./metrics.service";

@Module({
  controllers: [MetricsController],
  providers: [MetricsRepository, MetricsService],
})
export class MetricsModule {}
