import { Injectable, Logger } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";
import { throwProxyError } from "../../utils/proxy-error.util";

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
    if (!res.ok) await throwProxyError(res, "Workflow service", this.logger);
    if (res.status === 204) return {};
    return res.json();
  }
}
