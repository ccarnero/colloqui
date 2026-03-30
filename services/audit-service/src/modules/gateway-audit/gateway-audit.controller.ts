import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GatewayAuditService } from './gateway-audit.service';
import { TENANT_HEADER } from '@yoizen/shared';

@Controller('audit/gateway')
export class GatewayAuditController {
  constructor(private readonly gatewayAuditService: GatewayAuditService) {}

  @Get('stats')
  async getDashboardStats(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    return this.gatewayAuditService.getDashboardStats(tenantId);
  }

  @Get()
  async queryEvents(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query('method') method?: string,
    @Query('routeType') routeType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');

    const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 500);
    const offset = Math.max(Number(offsetStr) || 0, 0);

    const events = await this.gatewayAuditService.queryEvents(
      { method, routeType, from, to, limit, offset },
      tenantId,
    );

    return { events, limit, offset };
  }

  @Get(':requestId')
  async getEvent(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('requestId') requestId: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');

    const event = await this.gatewayAuditService.getEventByRequestId(requestId, tenantId);
    if (!event) {
      throw new NotFoundException(`Gateway audit event ${requestId} not found`);
    }
    return event;
  }
}
