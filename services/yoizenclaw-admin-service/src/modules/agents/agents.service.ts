import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  Inject,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  AgentsRepository,
  type IAgent,
  type ICreateAgentData,
  type IFindAllOptions,
  type IUpdateAgentData,
} from "./agents.repository";
import { NatsPublisher } from "../../providers/nats.provider";
import type {
  ChatRequestDto,
  ChatResponseDto,
  MemoryProposalActionResponseDto,
  MemoryProposalListResponseDto,
} from "./agents.dto";
import { AdaptersService } from "../adapters/adapters.service";
import { AgentsRuntimeService } from "./agents-runtime.service";
import { yoizenclawAdminServiceConfig } from "../../config";

@Injectable()
export class AgentsService {
  private readonly logger = new PinoLoggerService(AgentsService.name);

  constructor(
    private readonly repository: AgentsRepository,
    private readonly natsPublisher: NatsPublisher,
    private readonly runtimeService: AgentsRuntimeService,
    @Optional() private readonly adaptersService?: AdaptersService,
  ) {}

  async findAll(
    tenantId: string,
    options: IFindAllOptions = {},
  ): Promise<{ agents: IAgent[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  async findById(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.findById(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  async create(tenantId: string, data: ICreateAgentData): Promise<IAgent> {
    await this.validateConnectorRef(tenantId, data.model_config);
    await this.validateAdapterRefs(tenantId, data.tools);
    return this.repository.create(tenantId, data);
  }

  async update(
    tenantId: string,
    id: string,
    data: IUpdateAgentData,
  ): Promise<IAgent> {
    await this.validateConnectorRef(tenantId, data.model_config);
    await this.validateAdapterRefs(tenantId, data.tools);
    const agent = await this.repository.update(tenantId, id, data);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
  }

  async publish(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.publish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    try {
      await this.natsPublisher.publishAgentPublished(
        tenantId,
        agent.id,
        agent.name,
        {
          system_prompt: agent.system_prompt,
          model_config: agent.model_config,
          tools: agent.tools,
          channels: agent.channels,
          description: agent.description ?? undefined,
        },
      );
      this.logger.log(`Agent '${agent.name}' published and event emitted`);
    } catch (error) {
      this.logger.error(
        `Failed to emit agent.published event for agent '${agent.id}'`,
        error,
      );
    }

    return agent;
  }

  async unpublish(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.unpublish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    try {
      await this.natsPublisher.publishAgentUnpublished(
        tenantId,
        agent.id,
        agent.name,
      );
      this.logger.log(`Agent '${agent.name}' unpublished and event emitted`);
    } catch (error) {
      this.logger.error(
        `Failed to emit agent.unpublished event for agent '${agent.id}'`,
        error,
      );
    }

    return agent;
  }

  async chat(
    tenantId: string,
    agentId: string,
    dto: ChatRequestDto,
    userId?: string,
  ): Promise<ChatResponseDto> {
    const agent = await this.repository.findById(tenantId, agentId);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }
    if (agent.status !== "published") {
      throw new NotFoundException(`Agent '${agentId}' is not published`);
    }

    const resolvedUserId = dto.userId || userId;

    try {
      return this.runtimeService.chat(tenantId, agentId, dto, resolvedUserId);
    } catch (error) {
      this.logger.error(`Chat request failed for agent ${agentId}`, error);
      throw new BadGatewayException("Failed to get response from agent");
    }
  }

  async listMemoryProposals(
    tenantId: string,
  ): Promise<MemoryProposalListResponseDto> {
    return this.runtimeService.listMemoryProposals(tenantId);
  }

  async approveMemoryProposal(
    tenantId: string,
    proposalId: string,
    reviewerId?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.runtimeService.reviewMemoryProposal(
      tenantId,
      proposalId,
      "memory_proposals_approve",
      reviewerId,
    );
  }

  async rejectMemoryProposal(
    tenantId: string,
    proposalId: string,
    reviewerId?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.runtimeService.reviewMemoryProposal(
      tenantId,
      proposalId,
      "memory_proposals_reject",
      reviewerId,
    );
  }

  private async validateConnectorRef(
    tenantId: string,
    modelConfig?: Record<string, unknown>,
  ): Promise<void> {
    const llm = modelConfig?.llm as Record<string, unknown> | undefined;
    const connectorId = llm?.connectorId as string | undefined;
    if (!connectorId) return;

    const adapter = await this.adaptersService?.findOne(
      tenantId,
      connectorId,
    );

    if (!adapter) {
      throw new BadRequestException(
        `connectorId '${connectorId}' does not reference an existing adapter`,
      );
    }

    const hasLlmTag = adapter.tags?.includes("llm") ?? false;
    if (!hasLlmTag) {
      throw new BadRequestException(
        `Adapter '${connectorId}' is not tagged as 'llm'`,
      );
    }

    if (adapter.status !== "enabled") {
      throw new BadRequestException(
        `Adapter '${connectorId}' is '${adapter.status}'; expected 'enabled'`,
      );
    }
  }

  /**
   * When VALIDATE_ADAPTER_REFS is enabled, checks that each tool's
   * adapterRef points to an existing adapter and endpoint.
   */
  private async validateAdapterRefs(
    tenantId: string,
    tools?: unknown[],
  ): Promise<void> {
    if (!yoizenclawAdminServiceConfig.validateAdapterRefs || !tools?.length) {
      return;
    }

    for (const tool of tools) {
      const t = tool as Record<string, unknown>;
      const ref = t.adapterRef as
        | { adapterId?: string; endpointId?: string }
        | undefined;
      if (!ref?.adapterId) continue;

      const adapterExists = await this.adaptersService?.adapterExists(
        tenantId,
        ref.adapterId,
      );
      if (!adapterExists) {
        this.logger.warn(
          `Tool '${t.name ?? "unnamed"}' references adapter '${ref.adapterId}' which does not exist. ` +
            "Config will be saved but tool execution may fail.",
        );
        continue;
      }

      if (ref.endpointId) {
        const epExists = await this.adaptersService?.endpointExists(
          tenantId,
          ref.adapterId,
          ref.endpointId,
        );
        if (!epExists) {
          this.logger.warn(
            `Tool '${t.name ?? "unnamed"}' references endpoint '${ref.endpointId}' on adapter '${ref.adapterId}' which does not exist. ` +
              "Config will be saved but tool execution may fail.",
          );
        }
      }
    }
  }
}
