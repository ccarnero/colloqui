import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { ChatService } from "../chat/chat.service";
import type { ChatRequest } from "../chat/chat.dto";
import { RateLimitGuard, RateLimit } from "../rate-limit/rate-limit.guard";

interface IResponse {
  raw: {
    writeHead(statusCode: number, headers: Record<string, string>): void;
    write(chunk: string): void;
    end(): void;
  };
}

@Controller("execution")
@UseGuards(TenantGuard, RateLimitGuard)
export class ExecutionController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async execute(
    @TenantId() tenantId: string,
    @Body() body: ChatRequest,
  ): Promise<Record<string, unknown>> {
    const result = await this.chatService.generateReply(tenantId, body);
    return {
      response: result.text,
      reply: result.text,
      agentId: result.agentId,
      usage: result.usage,
      costUsd: result.costUsd,
      toolCalls: result.toolCalls,
      model: result.model,
      provider: result.provider,
    };
  }

  @Post("stream")
  @RateLimit({ windowMs: 60_000, maxRequests: 5 })
  async executeStream(
    @TenantId() tenantId: string,
    @Res() res: IResponse,
    @Body() body: ChatRequest,
  ): Promise<void> {
    res.raw.writeHead(HttpStatus.OK, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      const streamResult = await this.chatService.generateStream(tenantId, body);

      for await (const textChunk of streamResult.textStream) {
        res.raw.write(`data: ${JSON.stringify({ type: "text", text: textChunk })}\n\n`);
      }

      const usageResult = await streamResult.usage;
      const usage = {
        inputTokens: usageResult?.inputTokens ?? 0,
        outputTokens: usageResult?.outputTokens ?? 0,
        totalTokens: (usageResult?.inputTokens ?? 0) + (usageResult?.outputTokens ?? 0),
      };

      const finalChunk = JSON.stringify({
        type: "result",
        data: {
          agentId: streamResult.agentId,
          usage,
          model: streamResult.model,
          provider: streamResult.provider,
        },
      });

      res.raw.write(`data: ${finalChunk}\n\n`);
      res.raw.write("data: [DONE]\n\n");
      res.raw.end();
    } catch (error) {
      const errorChunk = JSON.stringify({
        type: "error",
        data: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
      res.raw.write(`data: ${errorChunk}\n\n`);
      res.raw.end();
    }
  }
}
