import { Injectable, NotFoundException, Logger, Inject, Optional } from '@nestjs/common';
import { AgentsRepository, type Agent, type CreateAgentData, type UpdateAgentData } from './agents.repository';
import { NatsPublisher, LAZY_NATS } from '../../providers/nats.provider';
import type { NatsConnection } from 'nats';
import type { ChatRequestDto, ChatResponseDto } from './agents.dto';
import { buildYoizenClawSubject, YOIZENCLAW_CHAT_RESPOND } from '@yoizen/shared';
import { AdaptersService } from '../adapters/adapters.service';

interface LazyNats {
  getConnection(): Promise<NatsConnection>;
}

const VALIDATE_ADAPTER_REFS =
  (process.env.VALIDATE_ADAPTER_REFS ?? 'true') !== 'false';

export interface FindAllOptions {
  status?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly repository: AgentsRepository,
    private readonly natsPublisher: NatsPublisher,
    @Inject(LAZY_NATS) private readonly lazyNats: LazyNats,
    @Optional() private readonly adaptersService?: AdaptersService,
  ) {}

  /**
   * Lista todos los agents con filtros y paginación.
   */
  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ agents: Agent[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  /**
   * Obtiene un agent por su ID.
   */
  async findById(tenantId: string, id: string): Promise<Agent> {
    const agent = await this.repository.findById(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  /**
   * Crea un nuevo agent. Optionally validates adapter refs in tools.
   */
  async create(tenantId: string, data: CreateAgentData): Promise<Agent> {
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
  ): Promise<Agent> {
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
  async publish(tenantId: string, id: string): Promise<Agent> {
    const agent = await this.repository.publish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    // Emitir evento NATS
    try {
      await this.natsPublisher.publishAgentPublished(
        tenantId,
        agent.id,
        agent.name,
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
  async unpublish(tenantId: string, id: string): Promise<Agent> {
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
  ): Promise<ChatResponseDto> {
    // 1. Verificar que el agente existe y está publicado
    const agent = await this.repository.findById(tenantId, agentId);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }
    if (agent.status !== 'published') {
      throw new NotFoundException(`Agent '${agentId}' is not published`);
    }

    // 2. Construir envelope CloudEvents (skill envelope-messages)
    const now = new Date().toISOString();
    const traceId = this.generateTraceId();
    const correlationId = dto.conversationId || `chat-${Date.now()}`;
    
    const payload = {
      action_type: 'chat_respond',
      agent_id: agentId,
      message: dto.message,
      conversation_id: correlationId,
      customer_name: dto.customerName || 'User',
      context: dto.context || [],
    };

    const envelope = {
      specversion: '1.0',
      id: this.generateEventId(),
      source: '//yoizenclaw-admin-service/admin/agents/chat',
      type: 'io.yoizen.yoizenclaw.chat.request.v1',
      resource: `tenant/${tenantId}/agents/${agentId}`,
      time: now,
      traceid: traceId,
      causation_id: null,
      correlation_id: correlationId,
      tenant: tenantId,
      producer: 'yoizenclaw-admin-service',
      domain: 'automation',
      channel: 'yoizenclaw',
      provider: 'internal',
      accountid: 'yoizenclaw-admin',
      idempotencykey: this.computeIdempotencyKey(payload),
      transport: {
        method: 'agent',
        protocol: 'internal',
        agent_id: 'yoizenclaw-admin-service',
        depth: 0,
      },
      data: {
        received_at: now,
        payload_inline: true,
        payload_ref: null,
        payload_bytes: JSON.stringify(payload).length,
        payload_checksum: this.computeChecksum(payload),
        payload,
      },
    };

    // 3. NATS Request-Reply
    const subject = buildYoizenClawSubject(YOIZENCLAW_CHAT_RESPOND, tenantId);
    
    try {
      this.logger.debug(`Sending chat request to ${subject} for agent ${agentId}`);
      
      // Request con timeout 30s
      const nc = await this.lazyNats.getConnection();
      const response = await nc.request(
        subject,
        JSON.stringify(envelope),
        { timeout: 30000 },
      );

      // 4. Parsear respuesta
      const responseData = JSON.parse(response.data.toString());
      
      if (!responseData.data?.payload?.response) {
        throw new Error('Invalid response from agent');
      }

      return {
        reply: responseData.data.payload.response,
        tool_calls: responseData.data.payload.tool_calls || [],
      };
    } catch (error) {
      this.logger.error(`Chat request failed for agent ${agentId}`, error);
      throw new NotFoundException('Failed to get response from agent');
    }
  }

  private generateTraceId(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private computeIdempotencyKey(payload: Record<string, unknown>): string {
    return `sha256:${this.computeChecksum(payload)}`;
  }

  private computeChecksum(payload: Record<string, unknown>): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return Buffer.from(canonical).toString('base64');
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
