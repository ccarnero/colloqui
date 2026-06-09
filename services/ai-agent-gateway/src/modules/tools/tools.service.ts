import { Injectable } from "@nestjs/common";
import { tracedFetch, PinoLoggerService } from "@yoizen/observability";
import { aiAgentGatewayConfig } from "../../config";

const PROXY_TIMEOUT_MS = 30_000;

/**
 * Proxies tool-related requests to agent-ai-service over HTTP.
 */
@Injectable()
export class ToolsService {
  private readonly logger = new PinoLoggerService(ToolsService.name);
  private readonly baseUrl = aiAgentGatewayConfig.services.agentAi;

  async listBuiltinTools(): Promise<object> {
    const url = `${this.baseUrl}/tools/builtins`;

    const res = await tracedFetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });

    if (!res.ok) {
      this.logger.error(
        `agent-ai-service /tools/builtins returned ${res.status}`,
      );
      throw new Error(
        `Failed to fetch builtin tools: ${res.status} ${res.statusText}`,
      );
    }

    return res.json();
  }
}
