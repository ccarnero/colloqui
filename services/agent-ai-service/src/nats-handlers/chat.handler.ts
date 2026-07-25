import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { VariableResolutionContext } from "@yoizen/shared";
import type { JetStreamClient } from "nats";
import type { ChatRequest, ChatResponse } from "../modules/chat/chat.dto";
import { ChatService } from "../modules/chat/chat.service";
import { JETSTREAM } from "../providers/nats.provider";

@Injectable()
export class ChatHandler {
  private readonly logger = new PinoLoggerService(ChatHandler.name);

  constructor(
    private readonly chatService: ChatService,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
  ) {}

  async handle(
    tenantId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const agentId = payload.agentId as string | undefined;
    const message = payload.message as string | undefined;

    if (!agentId || !message) {
      this.logger.warn(
        `[chat] Missing agentId or message for tenant '${tenantId}'`
      );
      return;
    }

    this.logger.log(
      `[chat] Processing: tenant='${tenantId}' agent='${agentId}' msg_len=${message.length}`
    );

    const request: ChatRequest = {
      agentId,
      message,
      conversationId: payload.conversationId as string | undefined,
      sessionId: payload.sessionId as string | undefined,
      chatId: payload.chatId as string | undefined,
      userId: payload.userId as string | undefined,
      customerName: payload.customerName as string | undefined,
      channel: payload.channel as string | undefined,
      context: payload.context as ChatRequest["context"],
      metadata: payload.metadata as Record<string, unknown> | undefined,
      // BUG A fix (agent-ai-service system-variable playground gap): the
      // published-agent runtime path (ExecutionHandler.handle) already
      // forwards `variables` from the incoming payload so `{{variables.*}}`
      // placeholders resolve via TemplateRendererService. The playground
      // path (this handler, action_type `chat_respond`) built its
      // ChatRequest without this field, so playground runs always saw
      // unresolved `{{variables.*}}` placeholders even when the caller
      // supplied a VariableResolutionContext. Mirror ExecutionHandler here
      // instead of duplicating resolution logic.
      variables: payload.variables as VariableResolutionContext | undefined,
    };

    try {
      const result: ChatResponse = await this.chatService.generateReply(
        tenantId,
        request
      );

      this.logger.log(
        `[chat] Completed: agent='${agentId}' tokens=${result.usage.totalTokens} cost=${result.costUsd?.toFixed(6) ?? "n/a"}`
      );
    } catch (error) {
      this.logger.error(
        `[chat] Failed for tenant='${tenantId}' agent='${agentId}': ${error}`
      );
      throw error;
    }
  }
}
