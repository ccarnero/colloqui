import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import { AgentsService } from './agents.service';
import { CreateAgentDto, UpdateAgentDto, ListAgentsQueryDto } from './agents.dto';
import type { Agent } from './agents.repository';

@Controller('admin/agents')
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  /**
   * Lista todos los agents con filtros opcionales.
   * GET /admin/agents?status=published&limit=20&offset=0
   */
  @Get()
  async findAll(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: ListAgentsQueryDto,
  ): Promise<{ agents: Agent[]; total: number }> {
    return this.service.findAll(tenantId, {
      status: query.status,
      is_active: query.is_active,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Obtiene un agent por su ID.
   * GET /admin/agents/:id
   */
  @Get(':id')
  async findById(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<Agent> {
    return this.service.findById(tenantId, id);
  }

  /**
   * Crea un nuevo agent.
   * POST /admin/agents
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
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

  /**
   * Actualiza un agent existente.
   * PUT /admin/agents/:id
   */
  @Put(':id')
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<Agent> {
    return this.service.update(tenantId, id, dto);
  }

  /**
   * Elimina (soft delete) un agent.
   * DELETE /admin/agents/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }

  /**
   * Publica un agent.
   * POST /admin/agents/:id/publish
   */
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<Agent> {
    return this.service.publish(tenantId, id);
  }

  /**
   * Despublica un agent.
   * POST /admin/agents/:id/unpublish
   */
  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<Agent> {
    return this.service.unpublish(tenantId, id);
  }
}
