import { Injectable, Logger } from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import { tracedFetch } from '@yoizen/observability';
import { gatewayConfig } from '../../config/gateway.config';
import { throwProxyError } from '../../utils/proxy-error.util';

const PROXY_TIMEOUT_MS = 30_000;

@Injectable()
export class AdminProxyService {
  private readonly logger = new Logger(AdminProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = gatewayConfig.services.admin;
  }

  /**
   * Forwards a request to the yoizenclaw-admin-service.
   *
   * @param method - HTTP method
   * @param path - Path relative to admin-service root (e.g. /admin/agents)
   * @param tenantId - Resolved tenant identifier
   * @param query - Optional query string params
   * @param body - Optional request body
   */
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
    const url = `${this.baseUrl}${path}${queryStr ? `?${queryStr}` : ''}`;

    const headers: Record<string, string> = {
      [TENANT_HEADER]: tenantId,
    };

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    };

    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await tracedFetch(url, init);
    if (!res.ok) await throwProxyError(res, 'Admin service', this.logger);
    if (res.status === 204) return {};
    return res.json();
  }
}