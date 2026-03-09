import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { AuditProxyService } from './audit.service';
import { REQUEST_TENANT_KEY } from '../../guards/tenant.guard';

@Controller('audit/events')
export class AuditController {
  constructor(private readonly auditProxy: AuditProxyService) {}

  @Get()
  async queryEvents(
    @Req() req: any,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<object> {
    return this.auditProxy.queryEvents(
      { type, from, to, limit, offset },
      req[REQUEST_TENANT_KEY],
    );
  }

  @Get(':id')
  async getEvent(@Req() req: any, @Param('id') id: string): Promise<object> {
    const event = await this.auditProxy.getEventById(id, req[REQUEST_TENANT_KEY]);
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }
}
