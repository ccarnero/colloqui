import { Injectable, Logger, HttpException } from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import { tracedFetch } from '@yoizen/observability';

@Injectable()
export class WorkflowProxyService {
  private readonly logger = new Logger(WorkflowProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.WORKFLOW_SERVICE_URL ??
      'http://workflow-api.platform-services.svc.cluster.local';
  }

  async proxy(
    method: string,
    path: string,
    tenantId: string,
    body?: unknown,
  ): Promise<object> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      [TENANT_HEADER]: tenantId,
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await tracedFetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(
        `Workflow service responded ${res.status} for ${method} ${url}`,
      );
      throw new HttpException(
        text || `Workflow service error: ${res.status}`,
        res.status,
      );
    }
    if (res.status === 204) return {};
    return res.json();
  }
}
