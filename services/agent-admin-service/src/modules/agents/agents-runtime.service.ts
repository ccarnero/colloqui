import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createInbox, headers, type NatsConnection } from 'nats';
import type {
  ChatRequestDto,
  ChatResponseDto,
  MemoryProposalActionResponseDto,
  MemoryProposalDto,
  MemoryProposalListResponseDto,
} from './agents.dto';
import { LAZY_NATS } from '../../providers/nats.provider';
import {
  buildPlatformSubject,
  PLATFORM_CHAT_RESPOND,
  PLATFORM_SUBJECT_PREFIX,
} from '@yoizen/shared';

interface LazyNats {
  getConnection(): Promise<NatsConnection>;
}

interface RuntimeEnvelopeResponse {
  data?: {
    payload?: unknown;
  };
}

interface RuntimePubAck {
  stream: string;
  seq: number;
}

@Injectable()
export class AgentsRuntimeService {
  private static readonly RUNTIME_RESPONSE_TIMEOUT_MS = 15 * 60 * 1000;

  private readonly logger = new Logger(AgentsRuntimeService.name);

  constructor(@Inject(LAZY_NATS) private readonly lazyNats: LazyNats) {}

  /**
   * Sends a chat request to the runtime and normalizes the response.
   */
  async chat(
    tenantId: string,
    agentId: string,
    dto: ChatRequestDto,
    userId?: string,
  ): Promise<ChatResponseDto> {
    const now = new Date().toISOString();
    const correlationId = dto.conversationId || `chat-${Date.now()}`;
    const responseData = await this.requestRuntime(
      tenantId,
      PLATFORM_CHAT_RESPOND,
      this.buildChatEnvelope(
        tenantId,
        agentId,
        dto,
        correlationId,
        this.generateTraceId(),
        now,
        userId,
      ),
      `chat request for agent ${agentId}`,
    );

    return this.parseChatResponse(responseData);
  }

  /**
   * Lists pending memory proposals.
   */
  async listMemoryProposals(
    tenantId: string,
    query?: {
      status?: string;
      kind?: string;
      limit?: number;
    },
  ): Promise<MemoryProposalListResponseDto> {
    const actionType = 'memory_proposals_list';
    const correlationId = `memory-proposals-list-${Date.now()}`;
    const now = new Date().toISOString();
    const responseData = await this.requestRuntime(
      tenantId,
      this.buildRuntimeActionSubject(actionType),
      this.buildRuntimeActionEnvelope(
        tenantId,
        actionType,
        {
          action_type: actionType,
          ...(query?.status ? { status: query.status } : {}),
          ...(query?.kind ? { kind: query.kind } : {}),
          ...(query?.limit !== undefined ? { limit: query.limit } : {}),
        },
        correlationId,
        now,
        '//agent-admin-service/admin/agents/memory-proposals/list',
      ),
      'memory proposals list request',
    );

    return {
      proposals: this.extractProposalList(responseData),
    };
  }

  /**
   * Reviews a memory proposal by approving or rejecting it.
   */
  async reviewMemoryProposal(
    tenantId: string,
    proposalId: string,
    actionType: 'memory_proposals_approve' | 'memory_proposals_reject',
    reviewerId?: string,
    reason?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    const correlationId = `${actionType}-${proposalId}-${Date.now()}`;
    const now = new Date().toISOString();
    const responseData = await this.requestRuntime(
      tenantId,
      this.buildRuntimeActionSubject(actionType),
      this.buildRuntimeActionEnvelope(
        tenantId,
        actionType,
        {
          action_type: actionType,
          memory_id: proposalId,
          ...(reviewerId?.trim() ? { actor: reviewerId.trim() } : {}),
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        },
        correlationId,
        now,
        `//agent-admin-service/admin/agents/memory-proposals/${actionType}`,
      ),
      `${actionType} request for proposal ${proposalId}`,
    );

    const payload = this.extractRuntimePayload(responseData);
    const proposal = this.tryMapProposal(
      payload.proposal,
    ) ?? this.tryMapProposal(payload.memory_proposal) ?? this.tryMapProposal(payload.item);

    return {
      success: this.readBoolean(payload.success) ?? this.readBoolean(payload.ok) ?? true,
      ...(proposal ? { proposal } : {}),
    };
  }

  private buildChatEnvelope(
    tenantId: string,
    agentId: string,
    dto: ChatRequestDto,
    correlationId: string,
    traceId: string,
    now: string,
    userId?: string,
  ): Record<string, unknown> {
    const payload = {
      action_type: 'chat_respond',
      agent_id: agentId,
      message: dto.message,
      conversation_id: correlationId,
      customer_name: dto.customerName || 'User',
      context: dto.context || [],
      ...(userId?.trim() ? { user_id: userId.trim() } : {}),
    };

    return {
      specversion: '1.0',
      id: this.generateEventId(),
      source: '//agent-admin-service/admin/agents/chat',
      type: 'io.yoizen.platform.chat.request.v1',
      resource: `tenant/${tenantId}/agents/${agentId}`,
      time: now,
      traceid: traceId,
      causation_id: null,
      correlation_id: correlationId,
      tenant: tenantId,
      producer: 'agent-admin-service',
      domain: 'automation',
      channel: 'platform',
      provider: 'internal',
      accountid: 'platform-admin',
      idempotencykey: this.computeIdempotencyKey(payload),
      transport: {
        method: 'agent',
        protocol: 'internal',
        agent_id: 'agent-admin-service',
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
  }

  private parseChatResponse(responseData: unknown): ChatResponseDto {
    const payload = this.extractRuntimePayload(responseData);
    const payloadSuccess = this.readBoolean(payload.success);

    if (payloadSuccess === false) {
      const errorMessage = this.extractRuntimeErrorMessage(payload);
      throw new BadGatewayException(
        errorMessage
          ? `Runtime chat error: ${errorMessage}`
          : 'Runtime chat request failed',
      );
    }

    const chatPayload = this.extractRuntimeChatPayload(payload);
    const reply =
      this.readOptionalString(chatPayload.response) ??
      this.readOptionalString(chatPayload.reply);

    if (!reply) {
      throw new BadGatewayException('Invalid response from agent');
    }

    return {
      reply,
      tool_calls: Array.isArray(chatPayload.tool_calls)
        ? chatPayload.tool_calls
        : [],
    };
  }

  private async requestRuntime(
    tenantId: string,
    subjectTemplate: string,
    envelope: Record<string, unknown>,
    logContext: string,
  ): Promise<unknown> {
    const subject = buildPlatformSubject(subjectTemplate, tenantId);

    this.logger.debug(`Sending ${logContext} to ${subject}`);

    const nc = await this.lazyNats.getConnection();

    if (typeof nc.subscribe === 'function' && typeof nc.publish === 'function') {
      return this.requestRuntimeWithInbox(nc, subject, envelope);
    }

    const response = await nc.request(subject, JSON.stringify(envelope), {
      timeout: AgentsRuntimeService.RUNTIME_RESPONSE_TIMEOUT_MS,
    });
    return JSON.parse(response.data.toString()) as unknown;
  }

  private requestRuntimeWithInbox(
    nc: NatsConnection,
    subject: string,
    envelope: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const inbox = createInbox();
      const payload = JSON.stringify(envelope);
      let settled = false;
      const timeoutRef = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        subscription.unsubscribe();
        reject(new BadGatewayException('Timeout waiting for runtime response'));
      }, AgentsRuntimeService.RUNTIME_RESPONSE_TIMEOUT_MS);

      const subscription = nc.subscribe(inbox, {
        callback: (error, message) => {
          if (settled) {
            return;
          }

          if (error) {
            settled = true;
            clearTimeout(timeoutRef);
            subscription.unsubscribe();
            reject(error);
            return;
          }

          try {
            const parsed = JSON.parse(message.data.toString()) as unknown;

            if (this.isJetStreamPubAck(parsed)) {
              return;
            }

            settled = true;
            clearTimeout(timeoutRef);
            subscription.unsubscribe();
            resolve(parsed);
          } catch (parseError) {
            settled = true;
            clearTimeout(timeoutRef);
            subscription.unsubscribe();
            reject(parseError);
          }
        },
      });

      try {
        const replyHeaders = headers();
        replyHeaders.set('x-reply-to', inbox);
        nc.publish(subject, payload, { reply: inbox, headers: replyHeaders });
      } catch (publishError) {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutRef);
          subscription.unsubscribe();
          reject(publishError);
        }
      }
    });
  }

  private isJetStreamPubAck(value: unknown): value is RuntimePubAck {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.stream === 'string' && typeof candidate.seq === 'number'
    );
  }

  private buildRuntimeActionSubject(actionType: string): string {
    return `${PLATFORM_SUBJECT_PREFIX}.${actionType}.v1`;
  }

  private buildRuntimeActionEnvelope(
    tenantId: string,
    actionType: string,
    payload: Record<string, unknown>,
    correlationId: string,
    now: string,
    source: string,
  ): Record<string, unknown> {
    return {
      specversion: '1.0',
      id: this.generateEventId(),
      source,
      type: `io.yoizen.platform.${actionType}.request.v1`,
      resource: `tenant/${tenantId}`,
      time: now,
      traceid: this.generateTraceId(),
      causation_id: null,
      correlation_id: correlationId,
      tenant: tenantId,
      producer: 'agent-admin-service',
      domain: 'automation',
      channel: 'platform',
      provider: 'internal',
      accountid: 'platform-admin',
      idempotencykey: this.computeIdempotencyKey(payload),
      transport: {
        method: 'agent',
        protocol: 'internal',
        agent_id: 'agent-admin-service',
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
  }

  private extractRuntimePayload(responseData: unknown): Record<string, unknown> {
    if (typeof responseData !== 'object' || responseData === null) {
      throw new BadGatewayException('Invalid response from runtime');
    }

    const envelopePayload = (responseData as RuntimeEnvelopeResponse).data?.payload;

    if (typeof envelopePayload === 'object' && envelopePayload !== null) {
      return envelopePayload as Record<string, unknown>;
    }

    return responseData as Record<string, unknown>;
  }

  private extractRuntimeChatPayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (
      typeof payload.response === 'string' ||
      typeof payload.reply === 'string'
    ) {
      return payload;
    }

    const nestedData = payload.data;
    if (typeof nestedData === 'object' && nestedData !== null) {
      return nestedData as Record<string, unknown>;
    }

    return payload;
  }

  private extractRuntimeErrorMessage(
    payload: Record<string, unknown>,
  ): string | undefined {
    const rootMessage = this.readOptionalString(payload.message);
    if (rootMessage) {
      return rootMessage;
    }

    const error = payload.error;
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }

    return this.readOptionalString((error as Record<string, unknown>).message);
  }

  private extractProposalList(responseData: unknown): MemoryProposalDto[] {
    const payload = this.extractRuntimePayload(responseData);
    const candidates = [payload.proposals, payload.items, payload.results];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      return candidate
        .map((item) => this.tryMapProposal(item))
        .filter((item): item is MemoryProposalDto => item !== null);
    }

    return [];
  }

  private tryMapProposal(value: unknown): MemoryProposalDto | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const proposal = value as Record<string, unknown>;
    const id = proposal.id;

    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }

    const rawExcerpt =
      this.readOptionalString(proposal.content_excerpt) ??
      this.readOptionalString(proposal.excerpt) ??
      this.readOptionalString(proposal.content);

    return {
      id,
      kind: this.readOptionalString(proposal.kind),
      title: this.readOptionalString(proposal.title),
      content_excerpt: rawExcerpt?.slice(0, 240),
      status: this.readOptionalString(proposal.status),
      created_at: this.readOptionalString(proposal.created_at),
      updated_at: this.readOptionalString(proposal.updated_at),
    };
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private generateTraceId(): string {
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
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
}
