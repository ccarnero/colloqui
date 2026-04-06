import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  AgentsRepository,
  type IAgent,
  type ICreateAgentData,
  type IFindAllOptions,
  type IUpdateAgentData,
} from "./agents.repository";
import { NatsPublisher, LAZY_NATS } from "../../providers/nats.provider";
import type { NatsConnection } from "nats";
import type { ChatRequestDto, ChatResponseDto } from "./agents.dto";
import {
  buildYoizenClawSubject,
  YOIZENCLAW_CHAT_RESPOND,
} from "@yoizen/shared";
import { AdaptersService } from "../adapters/adapters.service";
import { yoizenclawAdminServiceConfig } from "../../config";
import { calculateChecksum } from "../../utils/payload-utils";

interface ILazyNats {
  getConnection(): Promise<NatsConnection>;
}

@Injectable()
export class AgentsService {
  private readonly logger = new PinoLoggerService(AgentsService.name);

  constructor(
    private readonly repository: AgentsRepository,
    private readonly natsPublisher: NatsPublisher,
    @Inject(LAZY_NATS) private readonly lazyNats: ILazyNats,
    private readonly adaptersService: AdaptersService,
  ) {}

  /**
   * Lists agents with filters and pagination.
   */
  async findAll(
    tenantId: string,
    options: IFindAllOptions = {},
  ): Promise<{ agents: IAgent[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  /**
   * Returns an agent by ID.
   */
  async findById(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.findById(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  /**
   * Creates a new agent. Optionally validates adapter refs in tools.
   */
  async create(tenantId: string, data: ICreateAgentData): Promise<IAgent> {
    await this.validateAdapterRefs(tenantId, data.tools);
    return this.repository.create(tenantId, data);
  }

  /**
   * Updates an existing agent. Optionally validates adapter refs in tools.
   */
  async update(
    tenantId: string,
    id: string,
    data: IUpdateAgentData,
  ): Promise<IAgent> {
    await this.validateAdapterRefs(tenantId, data.tools);
    const agent = await this.repository.update(tenantId, id, data);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  /**
   * Soft-deletes an agent.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
  }

  /**
   * Publishes an agent and emits a NATS event.
   */
  async publish(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.publish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    // Emit NATS event
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
      // Swallow errors so publish still succeeds; problem is logged
    }

    return agent;
  }

  /**
   * Unpublishes an agent and emits a NATS event.
   */
  async unpublish(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.unpublish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    // Emit NATS event
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
      // Swallow errors so unpublish still succeeds
    }

    return agent;
  }

  /**
   * Chat with an agent via NATS request-reply (CloudEvents envelope pattern).
   */
  async chat(
    tenantId: string,
    agentId: string,
    dto: ChatRequestDto,
  ): Promise<ChatResponseDto> {
    const agent = await this.repository.findById(tenantId, agentId);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }
    if (agent.status !== "published") {
      throw new NotFoundException(`Agent '${agentId}' is not published`);
    }

    const now = new Date().toISOString();
    const traceId = this.generateTraceId();
    const correlationId = dto.conversationId || `chat-${Date.now()}`;
    const envelope = this.buildChatPayload({
      tenantId,
      agentId,
      dto,
      correlationId,
      traceId,
      now,
    });

    const subject = buildYoizenClawSubject(YOIZENCLAW_CHAT_RESPOND, tenantId);

    try {
      this.logger.debug(
        `Sending chat request to ${subject} for agent ${agentId}`,
      );

      const nc = await this.lazyNats.getConnection();
      const response = await nc.request(subject, JSON.stringify(envelope), {
        timeout: yoizenclawAdminServiceConfig.chatRequestTimeoutMs,
      });

      const responseData: unknown = JSON.parse(response.data.toString());
      return this.parseChatResponse(responseData);
    } catch (error) {
      this.logger.error(`Chat request failed for agent ${agentId}`, error);
      throw new BadGatewayException("Failed to get response from agent");
    }
  }

  private buildChatPayload(options: {
    tenantId: string;
    agentId: string;
    dto: ChatRequestDto;
    correlationId: string;
    traceId: string;
    now: string;
  }): Record<string, unknown> {
    const { tenantId, agentId, dto, correlationId, traceId, now } = options;
    const payload = {
      action_type: "chat_respond",
      agent_id: agentId,
      message: dto.message,
      conversation_id: correlationId,
      customer_name: dto.customerName || "User",
      context: dto.context || [],
    };

    return {
      specversion: "1.0",
      id: this.generateEventId(),
      source: "//yoizenclaw-admin-service/admin/agents/chat",
      type: "io.yoizen.yoizenclaw.chat.request.v1",
      resource: `tenant/${tenantId}/agents/${agentId}`,
      time: now,
      traceid: traceId,
      causation_id: null,
      correlation_id: correlationId,
      tenant: tenantId,
      producer: "yoizenclaw-admin-service",
      domain: "automation",
      channel: "yoizenclaw",
      provider: "internal",
      accountid: "yoizenclaw-admin",
      idempotencykey: this.computeIdempotencyKey(payload),
      transport: {
        method: "agent",
        protocol: "internal",
        agent_id: "yoizenclaw-admin-service",
        depth: 0,
      },
      data: {
        received_at: now,
        payload_inline: true,
        payload_ref: null,
        payload_bytes: JSON.stringify(payload).length,
        payload_checksum: calculateChecksum(payload),
        payload,
      },
    };
  }

  private parseChatResponse(responseData: unknown): ChatResponseDto {
    if (
      typeof responseData !== "object" ||
      responseData === null ||
      !("data" in responseData)
    ) {
      throw new BadGatewayException("Invalid response from agent");
    }
    const data = (responseData as { data?: { payload?: unknown } }).data;
    const payload = data?.payload as
      | {
          response?: unknown;
          tool_calls?: unknown;
        }
      | undefined;
    if (!payload?.response) {
      throw new BadGatewayException("Invalid response from agent");
    }

    return {
      reply: payload.response as string,
      tool_calls: (payload.tool_calls || []) as unknown[],
    };
  }

  private generateTraceId(): string {
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  }

  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private computeIdempotencyKey(payload: Record<string, unknown>): string {
    return calculateChecksum(payload);
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
    if (!yoizenclawAdminServiceConfig.validateAdapterRefs || !tools?.length) {
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
