import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_TENANT_KEY } from '../decorators/skip-tenant.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TENANT_HEADER } from '@yoizen/shared';
import type { YoizenRequest } from '../types/yoizen-request';
import { HOST_PATTERN } from '../constants';

export const REQUEST_TENANT_KEY = 'tenantId';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<YoizenRequest>();
    const tenantId = this.resolveTenant(request);

    request[REQUEST_TENANT_KEY] = tenantId;
    request.headers[TENANT_HEADER] = tenantId;

    return true;
  }

  private resolveTenant(request: YoizenRequest): string {
    const host: string = request.headers.host ?? '';
    const match = HOST_PATTERN.exec(host);
    if (match) return match[1];

    const rawHeader = request.headers[TENANT_HEADER];
    const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof header === "string" && header.length > 0) return header;

    const q = request.query as { tenant?: unknown };
    const queryTenant = q.tenant;
    if (typeof queryTenant === "string" && queryTenant.length > 0) {
      return queryTenant;
    }

    throw new BadRequestException('Tenant context required. Provide tenant via hostname or x-yoizen-tenant header.');
  }
}
