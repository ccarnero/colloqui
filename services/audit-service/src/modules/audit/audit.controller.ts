import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { TENANT_HEADER } from '@yoizen/shared';

@Controller('audit/events')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async queryEvents(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');

    const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 500);
    const offset = Math.max(Number(offsetStr) || 0, 0);

    const events = await this.auditService.queryEvents(
      { type, from, to, limit, offset },
      tenantId,
    );

    return { events, limit, offset };
  }

  @Get(':id')
  async getEvent(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');

    const event = await this.auditService.getEventById(id, tenantId);
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }
    return event;
  }
}
