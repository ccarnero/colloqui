import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';

@Injectable()
export class AuthProxyService {
  private readonly logger = new Logger(AuthProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.AUTH_SERVICE_URL ??
      'http://auth-service.platform-services.svc.cluster.local';
  }

  async proxy(
    method: string,
    path: string,
    body?: object,
    headers?: Record<string, string>,
    tenantId?: string,
  ): Promise<object> {
    const url = `${this.baseUrl}${path}`;
    const outHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (tenantId) {
      outHeaders[TENANT_HEADER] = tenantId;
    }

    const init: RequestInit = { method, headers: outHeaders };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Auth service responded ${res.status}: ${text}`);

      let parsed: object;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text };
      }

      throw new HttpException(parsed, res.status as HttpStatus);
    }

    if (res.status === 204) return { success: true };
    return res.json();
  }
}
