import { Injectable, Logger } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";
import { throwProxyError } from "../../utils/proxy-error.util";

@Injectable()
export class AuthProxyService {
  private readonly logger = new Logger(AuthProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.AUTH_SERVICE_URL ??
      'http://auth-service.platform-services.svc.cluster.local';
  }

  async proxy(
    method: string,
    path: string,
    body?: object,
    headers?: Record<string, string>,
    tenantId?: string,
  ): Promise<object> {
    const url = `${this.baseUrl}${path}`;
    const outHeaders: Record<string, string> = { ...headers };

    if (tenantId) {
      outHeaders[TENANT_HEADER] = tenantId;
    }

    const init: RequestInit = { method, headers: outHeaders };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      outHeaders['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await tracedFetch(url, init);

    if (!res.ok) await throwProxyError(res, "Auth service", this.logger);

    if (res.status === 204) return { success: true };
    return res.json();
  }
}
