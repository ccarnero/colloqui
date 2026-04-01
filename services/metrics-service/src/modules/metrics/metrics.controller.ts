import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { QueryMetricsDto } from './metrics.dto';
import { TENANT_HEADER } from '@yoizen/shared';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async queryMetrics(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query() query: QueryMetricsDto,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');

    const { source, name, from, to } = query;
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);

    const metrics = await this.metricsService.queryMetrics(
      { source, name, from, to, limit, offset },
      tenantId,
    );

    return { metrics, limit, offset };
  }

  @Get(':id')
  async getMetric(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');

    const metric = await this.metricsService.getMetricById(id, tenantId);
    if (!metric) {
      throw new NotFoundException(`Metric ${id} not found`);
    }
    return metric;
  }
}
