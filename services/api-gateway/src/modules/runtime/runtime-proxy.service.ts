import { Injectable } from "@nestjs/common";
import { tracedFetch, PinoLoggerService } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import { gatewayConfig } from "../../config";
import { PROXY_TIMEOUT_MS } from "../../constants";
import { throwProxyError } from "../../utils/proxy-error.util";
import { setTrustedUserIdHeader } from "../../utils/trusted-user-header.util";

export interface IRuntimeProxyOptions {
  method: string;
  path: string;
  tenantId: string;
  body?: unknown;
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
    if (res.status === 204) return {};
    return res.json();
  }
}
