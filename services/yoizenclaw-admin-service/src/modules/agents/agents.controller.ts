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
  Headers,
} from "@nestjs/common";
import { AgentsService } from "./agents.service";
import {
  ChatRequestDto,
  ChatResponseDto,
  CreateAgentDto,
  ListAgentsQueryDto,
  MemoryProposalActionResponseDto,
  MemoryProposalListResponseDto,
  MemoryProposalParamDto,
  UpdateAgentDto,
} from "./agents.dto";
import type { IAgent } from "./agents.repository";
import { TenantGuard } from "../../providers/tenant.guard";
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
  ): Promise<IAgent> {
    return this.service.publish(tenantId, id);
  }

  @Post(":id/unpublish")
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IAgent> {
    return this.service.unpublish(tenantId, id);
  }

  @Post(":id/chat")
  @HttpCode(HttpStatus.OK)
  async chat(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: ChatRequestDto,
    @Headers(YOIZEN_USER_ID_HEADER) userId?: string,
  ): Promise<ChatResponseDto> {
    return this.service.chat(tenantId, id, dto, userId);
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
