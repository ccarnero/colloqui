import { Injectable, Logger } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";
import { throwProxyError } from "../../utils/proxy-error.util";
import { gatewayConfig } from "../../config/gateway.config";

@Injectable()
export class TenantProxyService {
  private readonly logger = new Logger(TenantProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = gatewayConfig.services.tenant;
  }

  async createTenant(body: object, tenantId?: string): Promise<object> {
    const url = `${this.baseUrl}/tenants`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await tracedFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return res.json();
  }

  async listTenants(tenantId?: string): Promise<object> {
    const url = `${this.baseUrl}/tenants`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await tracedFetch(url, { headers });
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return res.json();
  }

  async getTenant(name: string, tenantId?: string): Promise<object | null> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await tracedFetch(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return res.json();
  }

  async updateTenant(
    name: string,
    body: object,
    tenantId?: string,
  ): Promise<object | null> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await tracedFetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 404) return null;
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return res.json();
  }

  async deleteTenant(name: string, tenantId?: string): Promise<boolean> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await tracedFetch(url, { method: "DELETE", headers });
    if (res.status === 404) return false;
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return true;
  }
}
