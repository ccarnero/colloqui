import { Injectable, Logger } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";
import { throwProxyError } from "../../utils/proxy-error.util";

@Injectable()
export class AuditProxyService {
  private readonly logger = new Logger(AuditProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.AUDIT_SERVICE_URL ??
      'http://audit-service.platform-services.svc.cluster.local';
  }

  async queryEvents(
    params: Record<string, string | undefined>,
    tenantId: string,
  ): Promise<object> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, v);
    }
    const query = qs.toString();
    const url = `${this.baseUrl}/audit/events${query ? `?${query}` : ''}`;

    const res = await tracedFetch(url, {
      headers: { [TENANT_HEADER]: tenantId },
    });
    if (!res.ok) await throwProxyError(res, "Audit service", this.logger);
    return res.json();
  }

  async getEventById(id: string, tenantId: string): Promise<object | null> {
    const url = `${this.baseUrl}/audit/events/${encodeURIComponent(id)}`;
    const res = await tracedFetch(url, {
      headers: { [TENANT_HEADER]: tenantId },
    });
    if (res.status === 404) return null;
    if (!res.ok) await throwProxyError(res, "Audit service", this.logger);
    return res.json();
  }
}
