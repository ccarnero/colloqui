import { Inject, Injectable } from "@nestjs/common";
import type { NatsConnection } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { agentAiServiceConfig } from "../../config";

/**
 * NATS subject for tool execution requests.
 * Follows subject convention (DOCS/arquitectura/01-service-bus.md): evt.{tenant}.platform.tool.request.v1
 */
const TOOL_REQUEST_SUBJECT_TEMPLATE =
  "evt.{tenant}.platform.tool.request.v1";

const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class BackendClientService {
  private readonly logger = new PinoLoggerService(BackendClientService.name);

  constructor(
    @Inject(NATS_CONNECTION) private readonly nats: NatsConnection,
  ) {}

  /**
   * Determine whether a path should be routed via NATS (tool execution)
   * instead of HTTP.
   */
  private isToolPath(path: string): boolean {
    const normalized = path.trim();
    return (
      normalized.startsWith("/tools/") ||
      normalized.startsWith("/api/tools/")
    );
  }

  /**
   * Send a tool execution request over NATS using request-reply.
   * Wraps the payload in a command envelope compatible with the
   * runtime tool handler.
   */
  private async requestToolViaNats(
    method: string,
    path: string,
    data?: Record<string, unknown>,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
    tenantId?: string,
  ): Promise<unknown> {
    const subject = tenantId
      ? TOOL_REQUEST_SUBJECT_TEMPLATE.replace("{tenant}", tenantId)
      : "platform.tool.request";

    const command = {
      id: crypto.randomUUID(),
      kind: "command",
      source: "agent-ai-service",
      type: "tool.request",
      data: {
        method,
        path,
        data: data ?? {},
        headers: headers ?? {},
        params: params ?? {},
      },
      timestamp: new Date().toISOString(),
    };

    this.logger.log(
      `NATS tool request: ${method} ${path} → ${subject}`,
    );

    const response = await this.nats.request(
      subject,
      new TextEncoder().encode(JSON.stringify(command)),
      { timeout: DEFAULT_TIMEOUT_MS },
    );

    const rawResponse = new TextDecoder().decode(response.data).trim();
    if (!rawResponse) {
      return {};
    }

    const reply = JSON.parse(rawResponse) as Record<string, unknown>;

    if (reply.kind === "reply") {
      if (reply.success && reply.data !== undefined && reply.data !== null) {
        return reply.data;
      }
      const errorInfo = reply.error as
        | Record<string, unknown>
        | undefined;
      const errorMessage =
        (errorInfo?.message as string) ?? "Tool request failed";
      throw new Error(errorMessage);
    }

    return reply;
  }

  /**
   * Perform a GET request, routing through NATS for tool paths
   * or HTTP for all other paths.
   */
  async get(
    path: string,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
    tenantId?: string,
  ): Promise<unknown> {
    if (this.isToolPath(path)) {
      return this.requestToolViaNats(
        "GET",
        path,
        undefined,
        params,
        headers,
        tenantId,
      );
    }

    return this.httpGet(path, params, headers);
  }

  /**
   * Perform a POST request, routing through NATS for tool paths
   * or HTTP for all other paths.
   */
  async post(
    path: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>,
    tenantId?: string,
  ): Promise<unknown> {
    if (this.isToolPath(path)) {
      return this.requestToolViaNats(
        "POST",
        path,
        data,
        undefined,
        headers,
        tenantId,
      );
    }

    return this.httpPost(path, data, headers);
  }

  /**
   * Perform a PUT request, routing through NATS for tool paths
   * or HTTP for all other paths.
   */
  async put(
    path: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>,
    tenantId?: string,
  ): Promise<unknown> {
    if (this.isToolPath(path)) {
      return this.requestToolViaNats(
        "PUT",
        path,
        data,
        undefined,
        headers,
        tenantId,
      );
    }

    return this.httpPut(path, data, headers);
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────

  private buildHeaders(
    extra?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (extra) {
      Object.assign(headers, extra);
    }
    return headers;
  }

  private async httpGet(
    path: string,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    const baseUrl = agentAiServiceConfig.connectorAdminUrl;
    const url = new URL(path, baseUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.buildHeaders(headers),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `HTTP GET ${url} failed with status ${response.status}`,
      );
    }

    return response.json();
  }

  private async httpPost(
    path: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    const baseUrl = agentAiServiceConfig.connectorAdminUrl;
    const url = new URL(path, baseUrl);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: this.buildHeaders(headers),
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `HTTP POST ${url} failed with status ${response.status}`,
      );
    }

    return response.json();
  }

  private async httpPut(
    path: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    const baseUrl = agentAiServiceConfig.connectorAdminUrl;
    const url = new URL(path, baseUrl);

    const response = await fetch(url.toString(), {
      method: "PUT",
      headers: this.buildHeaders(headers),
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `HTTP PUT ${url} failed with status ${response.status}`,
      );
    }

    return response.json();
  }
}
