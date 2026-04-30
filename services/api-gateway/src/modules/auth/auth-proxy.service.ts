import { Injectable } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { throwProxyError } from "../../utils/proxy-error.util";
import { gatewayConfig } from "../../config";
import { PROXY_TIMEOUT_MS } from "../../constants";

export interface IAuthProxyRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: object;
  readonly headers?: Record<string, string>;
  readonly tenantId?: string;
}

@Injectable()
export class AuthProxyService {
  private readonly logger = new PinoLoggerService(AuthProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = gatewayConfig.services.auth;
  }

  /**
   * Forwards a request to auth-service with optional tenant header injection.
   *
   * @param request - Method, path, JSON body, forwarded headers, optional tenant.
   * @returns Parsed JSON body or `{ success: true }` on 204.
   */
  async proxy(request: IAuthProxyRequest): Promise<object> {
    const { method, path, body, headers, tenantId } = request;
    const url = `${this.baseUrl}${path}`;
    const outHeaders: Record<string, string> = { ...headers };

    if (tenantId) {
      outHeaders[TENANT_HEADER] = tenantId;
    }

    const init: RequestInit = {
      method,
      headers: outHeaders,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      outHeaders["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const res = await tracedFetch(url, init);

    if (!res.ok) await throwProxyError(res, "Auth service", this.logger);

    if (res.status === 204) return { success: true };
    return res.json();
  }
}
