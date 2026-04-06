import { Injectable } from "@nestjs/common";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import { gatewayConfig } from "../../config";
import { PROXY_TIMEOUT_MS } from "../../constants";
import { throwProxyError } from "../../utils/proxy-error.util";
import { setTrustedUserIdHeader } from "../../utils/trusted-user-header.util";

export interface IAdminProxyOptions {
  method: string;
  path: string;
  tenantId: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  trustedUserId?: string;
}

@Injectable()
export class AdminProxyService {
  private readonly logger = new PinoLoggerService(AdminProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = gatewayConfig.services.admin;
  }

  async proxy(options: IAdminProxyOptions): Promise<object> {
    const qs = new URLSearchParams();
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined) qs.set(k, v);
      }
    }
    const queryStr = qs.toString();
    const url = `${this.baseUrl}${options.path}${queryStr ? `?${queryStr}` : ""}`;

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
      await throwProxyError(res, "Admin service", this.logger);
    }
    if (res.status === 204) return {};
    return res.json();
  }
}
