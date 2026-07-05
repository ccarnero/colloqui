import { Injectable } from "@nestjs/common";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import type { FastifyReply } from "fastify";
import { gatewayConfig } from "../../config";
import { PROXY_TIMEOUT_MS } from "../../constants";
import { pipeUpstreamSseToReply } from "../../utils/pipe-upstream-sse-to-reply.util";
import { throwProxyError } from "../../utils/proxy-error.util";
import { setTrustedUserIdHeader } from "../../utils/trusted-user-header.util";

export interface IRuntimeProxyOptions {
  method: string;
  path: string;
  tenantId: string;
  body?: unknown;
  trustedUserId?: string;
}

export interface IRuntimeStreamProxyOptions {
  tenantId: string;
  body: unknown;
  trustedUserId?: string;
}

@Injectable()
export class RuntimeProxyService {
  private readonly logger = new PinoLoggerService(RuntimeProxyService.name);
  private readonly baseUrl = gatewayConfig.services.aiAgentGateway;

  async proxy(options: IRuntimeProxyOptions): Promise<object> {
    const url = `${this.baseUrl}${options.path}`;
    const headers: Record<string, string> = {
      [TENANT_HEADER]: options.tenantId,
    };

    if (options.trustedUserId) {
      setTrustedUserIdHeader(headers, options.trustedUserId);
    }

    const init: RequestInit = {
      method: options.method,
      headers,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    };

    if (
      options.body !== undefined &&
      options.method !== "GET" &&
      options.method !== "DELETE"
    ) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const res = await tracedFetch(url, init);
    if (!res.ok) {
      await throwProxyError(res, "YoizenClaw runtime gateway", this.logger);
    }
    if (res.status === 204) {
      return {};
    }
    return res.json();
  }

  /**
   * Streaming passthrough for the combined execute+stream endpoint
   * (DOCS/architecture/runtime-streaming.md §3.4). Unlike `proxy()`, this
   * never buffers the response — it hands the raw Fastify reply to
   * `pipeUpstreamSseToReply`, which hijacks it and pipes upstream SSE
   * chunks directly. Do NOT reuse `proxy()`/`pipeUpstreamResponseToReply`
   * here; those buffer via `res.json()` / `upstream.text()`.
   */
  async proxyStream(
    reply: FastifyReply,
    options: IRuntimeStreamProxyOptions
  ): Promise<void> {
    const upstreamUrl = `${this.baseUrl}/runtime/executions/stream`;
    const headers: Record<string, string> = {
      [TENANT_HEADER]: options.tenantId,
    };
    if (options.trustedUserId) {
      setTrustedUserIdHeader(headers, options.trustedUserId);
    }

    await pipeUpstreamSseToReply(reply, {
      upstreamUrl,
      headers,
      body: options.body,
    });
  }
}
