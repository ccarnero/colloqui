import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  UseGuards,
} from "@nestjs/common";
import { clampListLimit, clampListOffset } from "@yoizen/shared";
import { TenantGuard, TenantId } from "@yoizen/database";
import { ExecutionsService } from "./executions.service";
import { ListExecutionsQueryDto } from "./list-executions-query.dto";

/** Paginated execution logs for schedules. */
@Controller()
@UseGuards(TenantGuard)
export class ExecutionsController {
  constructor(private readonly executionsService: ExecutionsService) {}

  @Get("schedules/:scheduleId/executions")
  async findBySchedule(
    @TenantId() tenantId: string,
    @Param("scheduleId") scheduleId: string,
    @Query() query: ListExecutionsQueryDto,
  ) {
    const limit = clampListLimit(query.limit);
    const offset = clampListOffset(query.offset);
    return this.executionsService.findByScheduleId(
      scheduleId,
      { status: query.status, limit, offset },
      tenantId,
    );
  }

  @Get("executions")
  async findAll(
    @TenantId() tenantId: string,
    @Query() query: ListExecutionsQueryDto,
  ) {
    const limit = clampListLimit(query.limit);
    const offset = clampListOffset(query.offset);
    return this.executionsService.findAll(
      { status: query.status, limit, offset },
      tenantId,
    );
  }

  @Get("executions/:id")
  async findById(@TenantId() tenantId: string, @Param("id") id: string) {
    const execution = await this.executionsService.findById(id, tenantId);
    if (!execution) {
      throw new NotFoundException(`Execution ${id} not found`);
    }
    return execution;
  }
}
