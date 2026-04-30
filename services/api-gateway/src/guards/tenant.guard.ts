import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SKIP_TENANT_KEY } from "../decorators/skip-tenant.decorator";
import { TENANT_HEADER } from "@yoizen/shared";
import type { IYoizenRequest } from "../types/yoizen-request";
import { resolveTenantIdFromHttpRequest } from "../utils/tenant-resolution.util";

export const REQUEST_TENANT_KEY = "tenantId";

/**
 * Resolves the active tenant from hostname (`{tenant}.…`), `x-yoizen-tenant`,
 * or `?tenant=` and stores it on the request for downstream guards/proxies.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * @param context  Nest HTTP execution context.
   * @returns `true` when tenant is resolved or the route skips tenant resolution.
   */
  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<IYoizenRequest>();
    const tenantId = resolveTenantIdFromHttpRequest(
      request.headers,
      request.query,
    );
    if (!tenantId) {
      throw new BadRequestException(
        "Tenant context required. Provide tenant via hostname, x-yoizen-tenant header, or ?tenant= query.",
      );
    }

    request[REQUEST_TENANT_KEY] = tenantId;
    request.headers[TENANT_HEADER] = tenantId;

    return true;
  }
}
