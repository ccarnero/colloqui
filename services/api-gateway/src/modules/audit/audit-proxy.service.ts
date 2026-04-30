import { Injectable } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { gatewayConfig } from "../../config";
import { PROXY_TIMEOUT_MS } from "../../constants";
import { throwProxyError } from "../../utils/proxy-error.util";

@Injectable()
export class AuditProxyService {
  private readonly logger = new PinoLoggerService(AuditProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = gatewayConfig.services.audit;
  }

  async queryEvents(
    params: Record<string, string | undefined>,
    tenantId: string,
  ): Promise<object> {
    const url = this.buildAuditQueryUrl("/audit/events", params);
    return this.fetchAuditJson(url, tenantId);
  }

  async getEventById(id: string, tenantId: string): Promise<object | null> {
    const url = `${this.baseUrl}/audit/events/${encodeURIComponent(id)}`;
    return this.fetchAuditJson(url, tenantId, { allow404: true });
  }

  async queryChannelEvents(
    params: Record<string, string | undefined>,
    tenantId: string,
  ): Promise<object> {
    const url = this.buildAuditQueryUrl("/audit/channel-events", params);
    return this.fetchAuditJson(url, tenantId);
  }

  async getChannelEventById(
    id: string,
    tenantId: string,
  ): Promise<object | null> {
    const url = `${this.baseUrl}/audit/channel-events/${encodeURIComponent(id)}`;
    return this.fetchAuditJson(url, tenantId, { allow404: true });
  }

  private buildAuditQueryUrl(
    path: string,
    params: Record<string, string | undefined>,
  ): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, v);
    }
    const query = qs.toString();
    return `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
  }

  private async fetchAuditJson(
    url: string,
    tenantId: string,
    options: { allow404: true },
  ): Promise<object | null>;
  private async fetchAuditJson(
    url: string,
    tenantId: string,
    options?: { allow404?: false },
  ): Promise<object>;
  private async fetchAuditJson(
    url: string,
    tenantId: string,
    options: { allow404?: boolean } = {},
  ): Promise<object | null> {
    const res = await tracedFetch(url, {
      headers: { [TENANT_HEADER]: tenantId },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (options.allow404 && res.status === 404) return null;
    if (!res.ok) await throwProxyError(res, "Audit service", this.logger);
    return (await res.json()) as object;
  }
}
