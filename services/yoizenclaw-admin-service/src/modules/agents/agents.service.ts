import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AgentsRepository,
  type IAgent,
  type ICreateAgentData,
  type IFindAllOptions,
  type UpdateAgentData,
} from './agents.repository';
import { NatsPublisher } from '../../providers/nats.provider';
import type {
  ChatRequestDto,
  ChatResponseDto,
  MemoryProposalActionResponseDto,
  MemoryProposalListResponseDto,
} from './agents.dto';
import { AdaptersService } from '../adapters/adapters.service';
import { AgentsRuntimeService } from './agents-runtime.service';

const VALIDATE_ADAPTER_REFS =
  (process.env.VALIDATE_ADAPTER_REFS ?? 'true') !== 'false';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly repository: AgentsRepository,
    private readonly natsPublisher: NatsPublisher,
    private readonly runtimeService: AgentsRuntimeService,
    @Optional() private readonly adaptersService?: AdaptersService,
  ) {}

  /**
   * Lista todos los agents con filtros y paginación.
   */
  async findAll(
    tenantId: string,
    options: IFindAllOptions = {},
  ): Promise<{ agents: IAgent[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  /**
   * Obtiene un agent por su ID.
   */
  async findById(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.findById(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  /**
   * Crea un nuevo agent. Optionally validates adapter refs in tools.
   */
  async create(tenantId: string, data: ICreateAgentData): Promise<IAgent> {
    await this.validateAdapterRefs(tenantId, data.tools);
    return this.repository.create(tenantId, data);
  }

  /**
   * Actualiza un agent existente. Optionally validates adapter refs in tools.
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateAgentData,
  ): Promise<IAgent> {
    await this.validateAdapterRefs(tenantId, data.tools);
    const agent = await this.repository.update(tenantId, id, data);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  /**
   * Elimina (soft delete) un agent.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
  }

  /**
   * Publica un agent y emite evento NATS.
   */
  async publish(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.publish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    // Emitir evento NATS con configuración completa
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
      // No lanzamos error para no fallar la operación de publicar
      // pero logueamos el problema
    }

    return agent;
  }

  /**
   * Despublica un agent y emite evento NATS.
   */
  async unpublish(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.unpublish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    // Emitir evento NATS
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
      // No lanzamos error para no fallar la operación de despublicar
    }

    return agent;
  }

  /**
   * Chat con agent via NATS Request-Reply.
   * Sigue el patrón CloudEvents del skill envelope-messages.
   */
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
    if (agent.status !== 'published') {
      throw new NotFoundException(`Agent '${agentId}' is not published`);
    }

    // Prioritize userId from DTO (editable in playground) over header
    const resolvedUserId = dto.userId || userId;

    try {
      return this.runtimeService.chat(tenantId, agentId, dto, resolvedUserId);
    } catch (error) {
      this.logger.error(`Chat request failed for agent ${agentId}`, error);
      throw new BadGatewayException('Failed to get response from agent');
    }
  }

  /**
   * Lists memory proposals pending human review for the tenant.
   */
  async listMemoryProposals(
    tenantId: string,
  ): Promise<MemoryProposalListResponseDto> {
    return this.runtimeService.listMemoryProposals(tenantId);
  }

  /**
   * Approves a tenant memory proposal with an optional reviewer identity.
   */
  async approveMemoryProposal(
    tenantId: string,
    proposalId: string,
    reviewerId?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.runtimeService.reviewMemoryProposal(
      tenantId,
      proposalId,
      'memory_proposals_approve',
      reviewerId,
    );
  }

  /**
   * Rejects a tenant memory proposal with an optional reviewer identity.
   */
  async rejectMemoryProposal(
    tenantId: string,
    proposalId: string,
    reviewerId?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.runtimeService.reviewMemoryProposal(
      tenantId,
      proposalId,
      'memory_proposals_reject',
      reviewerId,
    );
  }

  /**
   * When VALIDATE_ADAPTER_REFS is enabled, checks that each tool's
   * adapterRef points to an existing adapter and endpoint. Logs
   * warnings for missing refs but does NOT block the save.
   */
  private async validateAdapterRefs(
    tenantId: string,
    tools?: unknown[],
  ): Promise<void> {
    if (!VALIDATE_ADAPTER_REFS || !this.adaptersService || !tools?.length) {
      return;
    }

    for (const tool of tools) {
      const t = tool as Record<string, unknown>;
      const ref = t.adapterRef as
        | { adapterId?: string; endpointId?: string }
        | undefined;
      if (!ref?.adapterId) continue;

      const adapterExists = await this.adaptersService.adapterExists(
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
        const epExists = await this.adaptersService.endpointExists(
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
