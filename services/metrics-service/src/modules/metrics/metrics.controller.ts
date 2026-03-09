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
import { TENANT_HEADER } from '@yoizen/shared';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async queryMetrics(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query('source') source?: string,
    @Query('name') name?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');

    const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 500);
    const offset = Math.max(Number(offsetStr) || 0, 0);

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
