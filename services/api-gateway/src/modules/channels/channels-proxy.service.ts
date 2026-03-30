import { Injectable, Logger } from "@nestjs/common";
import { TENANT_HEADER, DEFAULT_CHANNEL_SERVICE_URL } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";
import { throwProxyError } from "../../utils/proxy-error.util";

@Injectable()
export class ChannelsProxyService {
  private readonly logger = new Logger(ChannelsProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.CHANNEL_SERVICE_URL ?? DEFAULT_CHANNEL_SERVICE_URL;
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
    if (!res.ok) await throwProxyError(res, "Channel service", this.logger);
    if (res.status === 204) return {};
    return res.json();
  }
}
