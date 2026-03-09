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

export const REQUEST_TENANT_KEY = 'tenantId';

const HOST_PATTERN = /^[^.]+\.([^.]+)\.yplatform\.com$/;

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const tenantId = this.resolveTenant(request);

    request[REQUEST_TENANT_KEY] = tenantId;
    request.headers[TENANT_HEADER] = tenantId;

    return true;
  }

  private resolveTenant(request: any): string {
    const host: string = request.headers.host ?? '';
    const match = HOST_PATTERN.exec(host);
    if (match) return match[1];

    const header: string | undefined = request.headers[TENANT_HEADER];
    if (header) return header;

    throw new BadRequestException('Tenant context required. Provide tenant via hostname or x-yoizen-tenant header.');
  }
}
