import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
} from "@nestjs/common";
import { AgentsService } from "./agents.service";
import {
  CreateAgentDto,
  ListAgentsQueryDto,
  MemoryProposalActionResponseDto,
  MemoryProposalListResponseDto,
  MemoryProposalParamDto,
  UpdateAgentDto,
  UpdateEnabledToolsDto,
  UpdateEnabledMcpServersDto,
  UpdateToolDescriptionOverridesDto,
} from "./agents.dto";
import type { IAgent, IAgentVersion } from "./agents.repository.interface";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

const YOIZEN_USER_ID_HEADER = "x-yoizen-user-id";

@Controller("admin/agents")
@UseGuards(TenantGuard)
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @Query() query: ListAgentsQueryDto,
  ): Promise<{ agents: IAgent[]; total: number }> {
    return this.service.findAll(tenantId, {
      status: query.status,
      is_active: query.is_active,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get("memory-proposals")
  @HttpCode(HttpStatus.OK)
  async listMemoryProposals(
    @TenantId() tenantId: string,
  ): Promise<MemoryProposalListResponseDto> {
    return this.service.listMemoryProposals(tenantId);
  }

  @Get(":id")
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IAgent> {
    return this.service.findById(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateAgentDto,
  ): Promise<IAgent> {
    return this.service.create(tenantId, {
      name: dto.name,
      description: dto.description,
      system_prompt: dto.system_prompt,
      model_config: dto.model_config,
      tools: dto.tools,
      channels: dto.channels,
      knowledge_base_ids: dto.knowledge_base_ids,
      input_variables: dto.input_variables,
      output_variables: dto.output_variables,
    });
  }

  @Put(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<IAgent> {
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
    @Headers(YOIZEN_USER_ID_HEADER) userId?: string,
  ): Promise<IAgent> {
    return this.service.publish(tenantId, id, userId);
  }

  @Post(":id/unpublish")
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IAgent> {
    return this.service.unpublish(tenantId, id);
  }

  @Post(":id/revert")
  @HttpCode(HttpStatus.OK)
  async revertToPublished(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IAgent> {
    return this.service.revertToPublished(tenantId, id);
  }

  @Get(":id/versions")
  async listVersions(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IAgentVersion[]> {
    return this.service.listVersions(tenantId, id);
  }

  @Post(":id/versions/:versionId/rollback")
  @HttpCode(HttpStatus.OK)
  async rollbackToVersion(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Param("versionId") versionId: string,
  ): Promise<IAgent> {
    return this.service.rollbackToVersion(tenantId, id, versionId);
  }

  @Delete(":id/versions/:versionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVersion(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Param("versionId") versionId: string,
  ): Promise<void> {
    await this.service.deleteVersion(tenantId, id, versionId);
  }

  @Patch(":id/tools")
  @HttpCode(HttpStatus.OK)
  async updateEnabledTools(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateEnabledToolsDto,
  ): Promise<IAgent> {
    const { enabled_tools } = dto;
    if (enabled_tools !== null && !Array.isArray(enabled_tools)) {
      throw new BadRequestException(
        "enabled_tools must be an array of strings or null",
      );
    }
    return this.service.updateEnabledTools(tenantId, id, enabled_tools ?? null);
  }

  @Patch(":id/mcp-servers")
  @HttpCode(HttpStatus.OK)
  async updateEnabledMcpServers(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateEnabledMcpServersDto,
  ): Promise<IAgent> {
    const { enabled_mcp_servers } = dto;
    if (enabled_mcp_servers !== null && !Array.isArray(enabled_mcp_servers)) {
      throw new BadRequestException(
        "enabled_mcp_servers must be an array of strings or null",
      );
    }
    return this.service.updateEnabledMcpServers(tenantId, id, enabled_mcp_servers ?? null);
  }

  @Patch(":id/tool-descriptions")
  @HttpCode(HttpStatus.OK)
  async updateToolDescriptionOverrides(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateToolDescriptionOverridesDto,
  ): Promise<IAgent> {
    const { tool_description_overrides } = dto;
    if (
      tool_description_overrides !== null &&
      tool_description_overrides !== undefined &&
      (typeof tool_description_overrides !== "object" ||
        Array.isArray(tool_description_overrides))
    ) {
      throw new BadRequestException(
        "tool_description_overrides must be a Record<string, string> or null",
      );
    }
    return this.service.updateToolDescriptionOverrides(
      tenantId,
      id,
      tool_description_overrides ?? null,
    );
  }

  @Post("memory-proposals/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approveMemoryProposal(
    @TenantId() tenantId: string,
    @Param() params: MemoryProposalParamDto,
    @Headers(YOIZEN_USER_ID_HEADER) reviewerId?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.service.approveMemoryProposal(
      tenantId,
      params.id,
      reviewerId,
    );
  }

  @Post("memory-proposals/:id/reject")
  @HttpCode(HttpStatus.OK)
  async rejectMemoryProposal(
    @TenantId() tenantId: string,
    @Param() params: MemoryProposalParamDto,
    @Headers(YOIZEN_USER_ID_HEADER) reviewerId?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.service.rejectMemoryProposal(
      tenantId,
      params.id,
      reviewerId,
    );
  }
}
