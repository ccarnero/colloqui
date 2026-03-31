import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AgentsService } from "./agents.service";
import { CreateAgentDto, UpdateAgentDto, ListAgentsQueryDto } from "./agents.dto";
import type { Agent } from "./agents.repository";
import { TenantGuard } from "../../providers/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

@Controller("admin/agents")
@UseGuards(TenantGuard)
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @Query() query: ListAgentsQueryDto,
  ): Promise<{ agents: Agent[]; total: number }> {
    return this.service.findAll(tenantId, {
      status: query.status,
      is_active: query.is_active,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(":id")
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<Agent> {
    return this.service.findById(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateAgentDto,
  ): Promise<Agent> {
    return this.service.create(tenantId, {
      name: dto.name,
      description: dto.description,
      system_prompt: dto.system_prompt,
      model_config: dto.model_config,
      tools: dto.tools,
      channels: dto.channels,
    });
  }

  @Put(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<Agent> {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }

  @Post(":id/publish")
  @HttpCode(HttpStatus.OK)
  async publish(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<Agent> {
    return this.service.publish(tenantId, id);
  }

  @Post(":id/unpublish")
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<Agent> {
    return this.service.unpublish(tenantId, id);
  }
}
