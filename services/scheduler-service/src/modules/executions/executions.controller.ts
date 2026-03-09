import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ExecutionsService } from './executions.service';
import { TENANT_HEADER } from '@yoizen/shared';

@Controller()
export class ExecutionsController {
  constructor(private readonly executionsService: ExecutionsService) {}

  @Get('schedules/:scheduleId/executions')
  async findBySchedule(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('scheduleId') scheduleId: string,
    @Query('status') status?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 500);
    const offset = Math.max(Number(offsetStr) || 0, 0);
    return this.executionsService.findByScheduleId(scheduleId, { status, limit, offset }, tenantId);
  }

  @Get('executions')
  async findAll(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query('status') status?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 500);
    const offset = Math.max(Number(offsetStr) || 0, 0);
    return this.executionsService.findAll({ status, limit, offset }, tenantId);
  }

  @Get('executions/:id')
  async findById(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    const execution = await this.executionsService.findById(id, tenantId);
    if (!execution) throw new NotFoundException(`Execution ${id} not found`);
    return execution;
  }
}
