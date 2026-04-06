import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Inject,
  forwardRef,
  UseGuards,
} from "@nestjs/common";
import { clampListLimit, clampListOffset } from "@yoizen/shared";
import { TenantGuard, TenantId } from "@yoizen/database";
import { SchedulesService, type ISchedule } from "./schedules.service";
import { CreateScheduleDto, UpdateScheduleDto } from "./schedules.dto";
import { ListSchedulesQueryDto } from "./list-schedules-query.dto";
import { EngineService } from "../../engine/engine.service";

@Controller("schedules")
@UseGuards(TenantGuard)
export class SchedulesController {
  constructor(
    private readonly schedulesService: SchedulesService,
    @Inject(forwardRef(() => EngineService))
    private readonly engineService: EngineService,
  ) {}

  @Post()
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateScheduleDto,
  ): Promise<ISchedule> {
    const schedule = await this.schedulesService.create(dto, tenantId);
    if (schedule.enabled && schedule.next_run_at) {
      this.engineService.addToQueue(tenantId, schedule);
    }
    return schedule;
  }

  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @Query() query: ListSchedulesQueryDto,
  ) {
    const limit = clampListLimit(query.limit);
    const offset = clampListOffset(query.offset);
    return this.schedulesService.findAll(
      { enabled: query.enabled, type: query.type, limit, offset },
      tenantId,
    );
  }

  @Get(":id")
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<ISchedule> {
    return this.schedulesService.findById(id, tenantId);
  }

  @Patch(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateScheduleDto,
  ): Promise<ISchedule> {
    const schedule = await this.schedulesService.update(id, dto, tenantId);
    this.engineService.updateInQueue(tenantId, schedule);
    return schedule;
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.schedulesService.remove(id, tenantId);
    this.engineService.removeFromQueue(id);
  }

  @Post(":id/trigger")
  async trigger(@TenantId() tenantId: string, @Param("id") id: string) {
    const schedule = await this.schedulesService.findById(id, tenantId);
    await this.engineService.triggerScheduleManually(tenantId, schedule);
    return { triggered: true, schedule_id: id };
  }
}
