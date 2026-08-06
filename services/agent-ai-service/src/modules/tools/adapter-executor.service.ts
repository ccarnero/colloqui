import { Injectable, Logger } from "@nestjs/common";
import { agentAiServiceConfig } from "../../config";
import type {
  AdapterReference,
  ToolExecutionContext,
  ToolResult,
} from "./tool-definition";

export interface ResolvedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly timeoutMs: number;
}

@Injectable()
export class AdapterExecutorService {
  private readonly logger = new Logger(AdapterExecutorService.name);

  async execute(
    tenantId: string,
    adapterRef: AdapterReference,
    payload: Record<string, unknown>,
    _state: ToolExecutionContext
  ): Promise<ToolResult> {
    if (!tenantId) {
      return { success: false, output: null, error: "Missing tenant context" };
    }

    let resolved: ResolvedRequest;
    try {
      resolved = await this.resolveRequest(
        adapterRef.adapterId,
        adapterRef.endpointId,
        tenantId
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Adapter resolution failed: ${message}`);
      return { success: false, output: null, error: message };
    }

    try {
      this.validateUrl(resolved.url);

      const isBodyAllowed =
        resolved.method !== "GET" &&
        resolved.method !== "HEAD" &&
        resolved.method !== "OPTIONS";

      const response = await fetch(resolved.url, {
        method: resolved.method,
        headers: {
          ...resolved.headers,
          "X-Yoizen-Tenant": tenantId,
          "Content-Type": "application/json",
        },
        ...(isBodyAllowed ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(resolved.timeoutMs),
      });

      if (!response.ok) {
        return {
          success: false,
          output: null,
          error: `Adapter returned HTTP ${response.status} for ${resolved.method} ${resolved.url}`,
        };
      }

      const data = await response.json();
      return { success: true, output: this.truncateResponse(data) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Adapter request failed: ${message}`);
      return { success: false, output: null, error: message };
    }
  }

  private async resolveRequest(
    adapterId: string,
    endpointId: string,
    tenantId: string
  ): Promise<ResolvedRequest> {
    const baseUrl = agentAiServiceConfig.connectorAdminUrl;
    const url = `${baseUrl}/connectors/${adapterId}`;

    const response = await fetch(url, {
      headers: {
        "X-Yoizen-Tenant": tenantId,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 404) {
      throw new Error(`Adapter not found: ${adapterId}`);
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch adapter ${adapterId}: HTTP ${response.status}`
      );
    }

    const adapter = await response.json();
    const endpoints = adapter.endpoints ?? [];
    const endpoint = endpoints.find(
      (ep: Record<string, unknown>) => ep.id === endpointId
    );

    if (!endpoint) {
      throw new Error(
        `Endpoint '${endpointId}' not found in adapter '${adapterId}'`
      );
    }

    const adapterBaseUrl = (adapter.baseUrl as string).replace(/\/+$/, "");
    const endpointPath = ((endpoint.path as string) ?? "").replace(/^\/+/, "");
    const fullUrl = endpointPath
      ? `${adapterBaseUrl}/${endpointPath}`
      : adapterBaseUrl;

    const headers: Record<string, string> = {};
    for (const entry of adapter.headers ?? []) {
      const key = entry.key as string;
      const value = entry.value as string;
      if (key) {
        headers[key] = value;
      }
    }

    this.injectAuthHeaders(
      (adapter.authType as string) ?? "none",
      (adapter.authConfig as Record<string, unknown>) ?? {},
      headers
    );

    const timeoutMs =
      typeof endpoint.timeoutMs === "number"
        ? endpoint.timeoutMs
        : ((adapter.timeoutMs as number) ?? 5000);

    return {
      url: fullUrl,
      method: (endpoint.method as string) ?? "POST",
      headers,
      timeoutMs,
    };
  }

  private injectAuthHeaders(
    authType: string,
    authConfig: Record<string, unknown>,
    headers: Record<string, string>
  ): void {
    switch (authType) {
      case "api-key": {
        const headerName = (authConfig.headerName as string) ?? "X-Api-Key";
        const key = authConfig.key as string;
        if (key && !(headerName in headers)) {
          headers[headerName] = key;
        }
        break;
      }
      case "bearer": {
        const token =
          (authConfig.token as string) ??
          (authConfig.bearerToken as string) ??
          (authConfig.bearer_token as string) ??
          "";
        if (token && !("Authorization" in headers)) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        break;
      }
      case "basic": {
        const username = authConfig.username as string;
        const password = authConfig.password as string;
        if (username && !("Authorization" in headers)) {
          const credentials = btoa(`${username}:${password}`);
          headers["Authorization"] = `Basic ${credentials}`;
        }
        break;
      }
    }
  }

  private truncateResponse(data: unknown, maxBytes = 100_000): unknown {
    const serialized = JSON.stringify(data);
    const sizeBytes = new TextEncoder().encode(serialized).length;

    if (sizeBytes <= maxBytes) {
      return data;
    }

    this.logger.warn(
      `Truncating response: ${sizeBytes} bytes exceeds limit of ${maxBytes}`
    );

    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      return {
        _truncated: true,
        original_size_bytes: sizeBytes,
        top_level_keys: Object.keys(data as Record<string, unknown>).slice(
          0,
          20
        ),
        message: `Response truncated: ${sizeBytes} bytes exceeded limit of ${maxBytes} bytes`,
      };
    }

    if (Array.isArray(data)) {
      return {
        _truncated: true,
        original_size_bytes: sizeBytes,
        item_count: data.length,
        message: `Response truncated: ${sizeBytes} bytes exceeded limit of ${maxBytes} bytes`,
      };
    }

    return {
      _truncated: true,
      original_size_bytes: sizeBytes,
      message: `Response truncated: ${sizeBytes} bytes exceeded limit of ${maxBytes} bytes`,
    };
  }

  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid adapter URL: '${url}'`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Adapter URL must use http or https protocol: '${url}'`);
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      throw new Error("Adapter URL must not target localhost");
    }

    if (hostname === "169.254.169.254") {
      throw new Error("Adapter URL must not target cloud metadata endpoint");
    }

    if (hostname.startsWith("169.254.") || hostname.startsWith("fe80:")) {
      throw new Error("Adapter URL must not target link-local addresses");
    }

    const parts = hostname.split(".");

    if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
      const octets = parts.map(Number);

      if (
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
      ) {
        throw new Error(
          "Adapter URL must not target private/RFC1918 addresses"
        );
      }
    }
  }
}
