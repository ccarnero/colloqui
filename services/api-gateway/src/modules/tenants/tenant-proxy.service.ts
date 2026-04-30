import { Injectable } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { throwProxyError } from "../../utils/proxy-error.util";
import { gatewayConfig } from "../../config";
import { PROXY_TIMEOUT_MS } from "../../constants";

@Injectable()
export class TenantProxyService {
  private readonly logger = new PinoLoggerService(TenantProxyService.name);
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
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return res.json();
  }

  async listTenants(tenantId?: string): Promise<object> {
    const url = `${this.baseUrl}/tenants`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await tracedFetch(url, {
      headers,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return res.json();
  }

  async getTenant(name: string, tenantId?: string): Promise<object | null> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await tracedFetch(url, {
      headers,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
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
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return res.json();
  }

  async deleteTenant(name: string, tenantId?: string): Promise<boolean> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await tracedFetch(url, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (res.status === 404) return false;
    if (!res.ok) await throwProxyError(res, "Tenant service", this.logger);
    return true;
  }
}
