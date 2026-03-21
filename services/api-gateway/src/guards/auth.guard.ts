import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { JwtService } from '../modules/auth/jwt.service';
import { PublicRoutesCacheService } from '../modules/auth/public-routes-cache.service';
import { REQUEST_TENANT_KEY } from './tenant.guard';
import type { JwtPayload } from '@yoizen/shared';

export const REQUEST_USER_KEY = 'user';

const TENANT_SCOPE_PREFIX = 'tenant:';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly publicRoutesCache: PublicRoutesCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const method: string = request.method;
    const url: string = request.url.split('?')[0];

    const publicRoutes = await this.publicRoutesCache.getPublicRoutes();
    if (this.publicRoutesCache.isMatch(publicRoutes, method, url)) {
      return true;
    }

    const authHeader: string | undefined = request.headers.authorization ?? request.headers.Authorization;
    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedException('Invalid Authorization header format');
    }

    const payload = await this.jwtService.verify(parts[1]);
    request[REQUEST_USER_KEY] = payload;

    this.validateTenantScope(payload, request[REQUEST_TENANT_KEY]);

    const requiredScopes = this.reflector.getAllAndOverride<string[] | undefined>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredScopes && requiredScopes.length > 0) {
      this.checkScopes(payload, requiredScopes);
    }

    return true;
  }

  private validateTenantScope(payload: JwtPayload, tenantId: string | undefined): void {
    if (!tenantId) return;

    const scope = payload.scope as string;
    if (scope === 'platform') return;

    if (scope.startsWith(TENANT_SCOPE_PREFIX)) {
      const scopeTenant = scope.slice(TENANT_SCOPE_PREFIX.length);
      if (scopeTenant !== tenantId) {
        throw new ForbiddenException(
          `Token scope tenant '${scopeTenant}' does not match request tenant '${tenantId}'`,
        );
      }
    }
  }

  private checkScopes(payload: JwtPayload, required: string[]): void {
    const scope = payload.scope as string;
    if (scope === 'platform') return;

    const isTenant = scope.startsWith(TENANT_SCOPE_PREFIX);

    for (let i = 0; i < required.length; i++) {
      if (required[i] === 'tenant' && isTenant) return;
      if (required[i] === scope) return;
    }

    throw new ForbiddenException(
      'Insufficient scope for this resource',
    );
  }
}
