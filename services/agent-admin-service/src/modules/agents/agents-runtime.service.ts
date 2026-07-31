import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { tracedFetch } from "@yoizen/observability";
import {
  buildPlatformSubject,
  AGENT_ADMIN_CHAT_RESPOND,
  TENANT_HEADER,
  type VariableResolutionContext,
} from "@yoizen/shared";
import { createInbox, headers, type NatsConnection } from "nats";
import { agentAdminServiceConfig } from "../../config";
import { LAZY_NATS } from "../../providers/nats.provider";
import { SystemVariablesService } from "../system-variables/system-variables.service";
import type {
  ChatRequestDto,
  ChatResponseDto,
  MemoryProposalActionResponseDto,
  MemoryProposalDto,
  MemoryProposalListResponseDto,
} from "./agents.dto";

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

  constructor(
    @Inject(LAZY_NATS) private readonly lazyNats: LazyNats,
    private readonly systemVariablesService: SystemVariablesService
  ) {}

  /**
   * Sends a chat request to the runtime and normalizes the response.
   */
  async chat(
    tenantId: string,
    agentId: string,
    dto: ChatRequestDto,
    userId?: string
  ): Promise<ChatResponseDto> {
    const now = new Date().toISOString();
    const correlationId = dto.conversationId || `chat-${Date.now()}`;
    const variables = await this.buildVariablesContext(tenantId);
    const responseData = await this.requestRuntime(
      tenantId,
      AGENT_ADMIN_CHAT_RESPOND,
      this.buildChatEnvelope(
        tenantId,
        agentId,
        dto,
        correlationId,
        this.generateTraceId(),
        now,
        variables,
        userId
      ),
      `chat request for agent ${agentId}`
    );

    return this.parseChatResponse(responseData);
  }

  /**
   * Builds the `variables.system.*` namespace for the playground path from
   * agent-admin-service's own system-variables module, mirroring the
   * published-runtime path's shape (workflow-service's
   * `SystemVariablesProvider`, which flattens active `system_variables` rows
   * into a `{ name: value }` map under `variables.system`). Values —
   * including `secret`-typed ones — are forwarded as-is: the published
   * runtime path does the same (it reads the table directly and never masks
   * by type), because the raw value is what the template renderer needs to
   * resolve `{{variables.system.*}}` placeholders.
   *
   * Never throws: a lookup failure must not break the playground chat, so on
   * any error this logs a warning (without variable values) and returns an
   * empty context, matching the runtime path's own degrade-to-empty
   * behavior in `WorkflowsService`.
   */
  private async buildVariablesContext(
    tenantId: string
  ): Promise<VariableResolutionContext> {
    const emptyContext: VariableResolutionContext = {
      system: {},
      workflow: {},
      previous: {},
      node: {},
      request: {},
    };

    try {
      const { variables } = await this.systemVariablesService.findAll(tenantId);
      const system: Record<string, unknown> = {};
      for (const variable of variables) {
        system[variable.name] = variable.value;
      }

      return { ...emptyContext, system };
    } catch (error) {
      this.logger.warn(
        `Failed to load system variables for tenant '${tenantId}', continuing with empty variables context: ${error instanceof Error ? error.message : String(error)}`
      );
      return emptyContext;
    }
  }

  /**
   * Lists pending memory proposals.
   *
   * NOTE: this used to be a NATS request/reply call to a
   * `memory_proposals_list` action subject, but nothing in the platform
   * ever subscribed to that subject (agent-ai-service's message router only
   * handles `chat_respond`). That made every call hang until the 15 minute
   * RUNTIME_RESPONSE_TIMEOUT_MS fired. Memory proposals are actually owned
   * by agent-memory-service, which already exposes an HTTP endpoint for
   * this (`GET /admin/memories/proposals`), so we call that directly with a
   * bounded timeout instead of going through NATS.
   */
  async listMemoryProposals(
    tenantId: string,
    query?: {
      status?: string;
      kind?: string;
      limit?: number;
    }
  ): Promise<MemoryProposalListResponseDto> {
    const url = new URL(
      `${agentAdminServiceConfig.memoryServiceUrl}/admin/memories/proposals`
    );
    if (query?.kind) {
      url.searchParams.set("kind", query.kind);
    }
    if (query?.limit !== undefined) {
      url.searchParams.set("limit", String(query.limit));
    }

    const response = await this.requestMemoryService(
      url,
      tenantId,
      { method: "GET" },
      "memory proposals list request"
    );

    const body = (await response.json()) as { items?: unknown[] };
    const items = Array.isArray(body.items) ? body.items : [];

    return {
      proposals: items
        .map((item) => this.mapMemoryRecord(item))
        .filter((item): item is MemoryProposalDto => item !== null),
    };
  }

  /**
   * Reviews a memory proposal by approving or rejecting it.
   *
   * Same root cause as {@link listMemoryProposals}: this now calls
   * agent-memory-service's `PATCH /admin/memories/:id/approve|reject`
   * endpoints directly instead of requesting a NATS subject nobody answers.
   *
   * agent-memory-service's approve/reject endpoints don't currently accept
   * a reviewer id or reason, so those inputs are validated/trimmed but not
   * forwarded downstream yet.
   */
  async reviewMemoryProposal(
    tenantId: string,
    proposalId: string,
    actionType: "memory_proposals_approve" | "memory_proposals_reject",
    reviewerId?: string,
    reason?: string
  ): Promise<MemoryProposalActionResponseDto> {
    const action =
      actionType === "memory_proposals_approve" ? "approve" : "reject";
    const url = new URL(
      `${agentAdminServiceConfig.memoryServiceUrl}/admin/memories/${proposalId}/${action}`
    );

    this.logger.debug(
      `Reviewing proposal ${proposalId} (${action}) requested by ${reviewerId ?? "unknown"}${reason ? ` - ${reason}` : ""}`
    );

    const response = await this.requestMemoryService(
      url,
      tenantId,
      { method: "PATCH" },
      `${actionType} request for proposal ${proposalId}`
    );

    const body = (await response.json()) as unknown;
    const proposal = this.mapMemoryRecord(body);

    return {
      success: true,
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
    variables: VariableResolutionContext,
    userId?: string
  ): Record<string, unknown> {
    const payload = {
      action_type: "chat_respond",
      agent_id: agentId,
      message: dto.message,
      conversation_id: correlationId,
      customer_name: dto.customerName || "User",
      context: dto.context || [],
      variables,
      ...(userId?.trim() ? { user_id: userId.trim() } : {}),
    };

    return {
      specversion: "1.0",
      id: this.generateEventId(),
      source: "//agent-admin-service/admin/agents/chat",
      type: "io.yoizen.platform.chat.request.v1",
      resource: `tenant/${tenantId}/agents/${agentId}`,
      time: now,
      traceid: traceId,
      causation_id: null,
      correlation_id: correlationId,
      tenant: tenantId,
      producer: "agent-admin-service",
      domain: "automation",
      channel: "platform",
      provider: "internal",
      accountid: "platform-admin",
      idempotencykey: this.computeIdempotencyKey(payload),
      transport: {
        method: "agent",
        protocol: "internal",
        agent_id: "agent-admin-service",
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
          : "Runtime chat request failed"
      );
    }

    const chatPayload = this.extractRuntimeChatPayload(payload);
    const reply =
      this.readOptionalString(chatPayload.response) ??
      this.readOptionalString(chatPayload.reply);

    if (!reply) {
      throw new BadGatewayException("Invalid response from agent");
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
    logContext: string
  ): Promise<unknown> {
    const subject = buildPlatformSubject(subjectTemplate, tenantId);

    this.logger.debug(`Sending ${logContext} to ${subject}`);

    const nc = await this.lazyNats.getConnection();

    if (
      typeof nc.subscribe === "function" &&
      typeof nc.publish === "function"
    ) {
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
    envelope: Record<string, unknown>
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
        reject(new BadGatewayException("Timeout waiting for runtime response"));
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
        replyHeaders.set("x-reply-to", inbox);
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
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.stream === "string" && typeof candidate.seq === "number"
    );
  }

  /**
   * Calls agent-memory-service over HTTP with a bounded timeout so a
   * downstream outage or bug fails fast instead of hanging the caller.
   */
  private async requestMemoryService(
    url: URL,
    tenantId: string,
    init: RequestInit,
    logContext: string
  ): Promise<Response> {
    this.logger.debug(`Sending ${logContext} to ${url.toString()}`);

    const controller = new AbortController();
    const timeoutRef = setTimeout(
      () => controller.abort(),
      agentAdminServiceConfig.memoryServiceTimeoutMs
    );

    let response: Response;
    try {
      response = await tracedFetch(url.toString(), {
        ...init,
        headers: { [TENANT_HEADER]: tenantId },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new BadGatewayException(
          `Timeout waiting for memory service response (${logContext})`
        );
      }
      throw new BadGatewayException(
        `Failed to reach memory service for ${logContext}`
      );
    } finally {
      clearTimeout(timeoutRef);
    }

    if (response.status === 404) {
      throw new NotFoundException(`Memory proposal not found`);
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Memory service returned ${response.status} for ${logContext}`
      );
    }

    return response;
  }

  private extractRuntimePayload(
    responseData: unknown
  ): Record<string, unknown> {
    if (typeof responseData !== "object" || responseData === null) {
      throw new BadGatewayException("Invalid response from runtime");
    }

    const envelopePayload = (responseData as RuntimeEnvelopeResponse).data
      ?.payload;

    if (typeof envelopePayload === "object" && envelopePayload !== null) {
      return envelopePayload as Record<string, unknown>;
    }

    return responseData as Record<string, unknown>;
  }

  private extractRuntimeChatPayload(
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    if (
      typeof payload.response === "string" ||
      typeof payload.reply === "string"
    ) {
      return payload;
    }

    const nestedData = payload.data;
    if (typeof nestedData === "object" && nestedData !== null) {
      return nestedData as Record<string, unknown>;
    }

    return payload;
  }

  private extractRuntimeErrorMessage(
    payload: Record<string, unknown>
  ): string | undefined {
    const rootMessage = this.readOptionalString(payload.message);
    if (rootMessage) {
      return rootMessage;
    }

    const error = payload.error;
    if (typeof error !== "object" || error === null) {
      return undefined;
    }

    return this.readOptionalString((error as Record<string, unknown>).message);
  }

  /**
   * Maps an agent-memory-service memory record (camelCase `IMemory` shape,
   * e.g. `createdAt`/`updatedAt`) into the admin API's snake_case
   * MemoryProposalDto contract.
   */
  private mapMemoryRecord(value: unknown): MemoryProposalDto | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const id = record.id;

    if (typeof id !== "string" || id.length === 0) {
      return null;
    }

    const rawExcerpt =
      this.readOptionalString(record.content_excerpt) ??
      this.readOptionalString(record.excerpt) ??
      this.readOptionalString(record.content);

    return {
      id,
      kind: this.readOptionalString(record.kind),
      title: this.readOptionalString(record.title),
      content_excerpt: rawExcerpt?.slice(0, 240),
      status: this.readOptionalString(record.status),
      created_at: this.readDateString(record.created_at ?? record.createdAt),
      updated_at: this.readDateString(record.updated_at ?? record.updatedAt),
    };
  }

  private readDateString(value: unknown): string | undefined {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return undefined;
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private readBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
  }

  private generateTraceId(): string {
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
  }

  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private computeIdempotencyKey(payload: Record<string, unknown>): string {
    return `sha256:${this.computeChecksum(payload)}`;
  }

  private computeChecksum(payload: Record<string, unknown>): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return Buffer.from(canonical).toString("base64");
  }
}
