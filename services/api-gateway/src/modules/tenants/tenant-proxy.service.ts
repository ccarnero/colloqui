import { Injectable, Logger } from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';

@Injectable()
export class TenantProxyService {
  private readonly logger = new Logger(TenantProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.TENANT_SERVICE_URL ??
      'http://tenant-service.platform-services.svc.cluster.local';
  }

  async createTenant(body: object, tenantId?: string): Promise<object> {
    const url = `${this.baseUrl}/tenants`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Tenant service responded ${res.status}: ${text}`);
      throw new Error(`Tenant service error: ${res.status}`);
    }
    return res.json();
  }

  async listTenants(tenantId?: string): Promise<object> {
    const url = `${this.baseUrl}/tenants`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      this.logger.error(`Tenant service responded ${res.status} for ${url}`);
      throw new Error(`Tenant service error: ${res.status}`);
    }
    return res.json();
  }

  async getTenant(name: string, tenantId?: string): Promise<object | null> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await fetch(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      this.logger.error(`Tenant service responded ${res.status} for ${url}`);
      throw new Error(`Tenant service error: ${res.status}`);
    }
    return res.json();
  }

  async updateTenant(
    name: string,
    body: object,
    tenantId?: string,
  ): Promise<object | null> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Tenant service responded ${res.status}: ${text}`);
      throw new Error(`Tenant service error: ${res.status}`);
    }
    return res.json();
  }

  async deleteTenant(name: string, tenantId?: string): Promise<boolean> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = {};
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    const res = await fetch(url, { method: 'DELETE', headers });
    if (res.status === 404) return false;
    if (!res.ok) {
      this.logger.error(`Tenant service responded ${res.status} for ${url}`);
      throw new Error(`Tenant service error: ${res.status}`);
    }
    return true;
  }
}
