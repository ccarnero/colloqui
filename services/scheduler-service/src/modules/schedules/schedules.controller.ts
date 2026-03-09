import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { SchedulesService, type Schedule } from './schedules.service';
import { CreateScheduleDto, UpdateScheduleDto } from './schedule.dto';
import { EngineService } from '../../engine/engine.service';
import { TENANT_HEADER } from '@yoizen/shared';

@Controller('schedules')
export class SchedulesController {
  constructor(
    private readonly schedulesService: SchedulesService,
    @Inject(forwardRef(() => EngineService))
    private readonly engineService: EngineService,
  ) {}

  @Post()
  async create(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Body() dto: CreateScheduleDto,
  ): Promise<Schedule> {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    const schedule = await this.schedulesService.create(dto, tenantId);
    if (schedule.enabled && schedule.next_run_at) {
      this.engineService.addToQueue(tenantId, schedule);
    }
    return schedule;
  }

  @Get()
  async findAll(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query('enabled') enabled?: string,
    @Query('type') type?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 500);
    const offset = Math.max(Number(offsetStr) || 0, 0);
    return this.schedulesService.findAll({ enabled, type, limit, offset }, tenantId);
  }

  @Get(':id')
  async findById(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('id') id: string,
  ): Promise<Schedule> {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    return this.schedulesService.findById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ): Promise<Schedule> {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    const schedule = await this.schedulesService.update(id, dto, tenantId);
    this.engineService.updateInQueue(tenantId, schedule);
    return schedule;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    await this.schedulesService.remove(id, tenantId);
    this.engineService.removeFromQueue(id);
  }

  @Post(':id/trigger')
  async trigger(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    if (!tenantId) throw new BadRequestException('Missing x-yoizen-tenant header');
    const schedule = await this.schedulesService.findById(id, tenantId);
    await this.engineService.executeSchedule(tenantId, schedule);
    return { triggered: true, schedule_id: id };
  }
}
