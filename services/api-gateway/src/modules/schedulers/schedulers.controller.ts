import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SchedulerProxyService } from './schedulers.service';
import { REQUEST_TENANT_KEY } from '../../guards/tenant.guard';

@Controller('schedulers')
export class SchedulersController {
  constructor(private readonly proxy: SchedulerProxyService) {}

  @Post('schedules')
  async createSchedule(@Req() req: any, @Body() body: unknown) {
    return this.proxy.proxy('POST', '/schedules', req[REQUEST_TENANT_KEY], undefined, body);
  }

  @Get('schedules')
  async listSchedules(
    @Req() req: any,
    @Query('enabled') enabled?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.proxy.proxy('GET', '/schedules', req[REQUEST_TENANT_KEY], { enabled, type, limit, offset });
  }

  @Get('schedules/:id')
  async getSchedule(@Req() req: any, @Param('id') id: string) {
    return this.proxy.proxy('GET', `/schedules/${encodeURIComponent(id)}`, req[REQUEST_TENANT_KEY]);
  }

  @Patch('schedules/:id')
  async updateSchedule(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {
    return this.proxy.proxy('PATCH', `/schedules/${encodeURIComponent(id)}`, req[REQUEST_TENANT_KEY], undefined, body);
  }

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSchedule(@Req() req: any, @Param('id') id: string) {
    return this.proxy.proxy('DELETE', `/schedules/${encodeURIComponent(id)}`, req[REQUEST_TENANT_KEY]);
  }

  @Post('schedules/:id/trigger')
  async triggerSchedule(@Req() req: any, @Param('id') id: string) {
    return this.proxy.proxy('POST', `/schedules/${encodeURIComponent(id)}/trigger`, req[REQUEST_TENANT_KEY]);
  }

  @Get('schedules/:scheduleId/executions')
  async listScheduleExecutions(
    @Req() req: any,
    @Param('scheduleId') scheduleId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.proxy.proxy(
      'GET',
      `/schedules/${encodeURIComponent(scheduleId)}/executions`,
      req[REQUEST_TENANT_KEY],
      { status, limit, offset },
    );
  }

  @Get('executions')
  async listExecutions(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.proxy.proxy('GET', '/executions', req[REQUEST_TENANT_KEY], { status, limit, offset });
  }

  @Get('executions/:id')
  async getExecution(@Req() req: any, @Param('id') id: string) {
    return this.proxy.proxy('GET', `/executions/${encodeURIComponent(id)}`, req[REQUEST_TENANT_KEY]);
  }
}
