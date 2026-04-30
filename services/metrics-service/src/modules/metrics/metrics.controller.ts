import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  ParseUUIDPipe,
  UseGuards,
} from "@nestjs/common";
import { clampListLimit, clampListOffset } from "@yoizen/shared";
import { TenantGuard, TenantId } from "@yoizen/database";
import { MetricsService } from "./metrics.service";
import { QueryMetricsDto } from "./metrics.dto";

@Controller("metrics")
@UseGuards(TenantGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async queryMetrics(
    @TenantId() tenantId: string,
    @Query() query: QueryMetricsDto,
  ) {
    const { source, name, from, to } = query;
    const limit = clampListLimit(query.limit);
    const offset = clampListOffset(query.offset);

    const metrics = await this.metricsService.queryMetrics(
      { source, name, from, to, limit, offset },
      tenantId,
    );

    return { metrics, limit, offset };
  }

  @Get(":id")
  async getMetric(
    @TenantId() tenantId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const metric = await this.metricsService.getMetricById(id, tenantId);
    if (!metric) {
      throw new NotFoundException(`Metric ${id} not found`);
    }
    return metric;
  }
}
