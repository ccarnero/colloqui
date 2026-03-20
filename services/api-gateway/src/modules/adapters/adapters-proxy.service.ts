import { Injectable, Logger, HttpException } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";

@Injectable()
export class AdaptersProxyService {
  private readonly logger = new Logger(AdaptersProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.ADAPTER_SERVICE_URL ??
      "http://adapter-service.platform-services.svc.cluster.local";
  }

  async proxy(
    method: string,
    path: string,
    tenantId: string,
    query?: Record<string, string | undefined>,
    body?: unknown,
  ): Promise<object> {
    const qs = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) qs.set(k, v);
      }
    }
    const queryStr = qs.toString();
    const url = `${this.baseUrl}${path}${queryStr ? `?${queryStr}` : ""}`;

    const headers: Record<string, string> = {
      [TENANT_HEADER]: tenantId,
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && method !== "GET" && method !== "DELETE") {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const res = await tracedFetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.error(
        `Adapter service responded ${res.status} for ${method} ${url}`,
      );
      throw new HttpException(
        text || `Adapter service error: ${res.status}`,
        res.status,
      );
    }
    if (res.status === 204) return {};
    return res.json();
  }
}
