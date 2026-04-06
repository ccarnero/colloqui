import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { SCOPES_KEY } from "../decorators/scopes.decorator";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";
import { JwtService } from "../modules/auth/jwt.service";
import { PublicRoutesCacheService } from "../modules/auth/public-routes-cache.service";
import { REQUEST_TENANT_KEY } from "./tenant.guard";
import type { JwtPayload } from "@yoizen/shared";
import type { IYoizenRequest } from "../types/yoizen-request";
import { TENANT_SCOPE_PREFIX } from "../constants";

export const REQUEST_USER_KEY = "user";

/**
 * Enforces JWT auth (except `@Public()` and dynamic public routes), attaches the
 * verified payload to the request, and validates optional scopes/permissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly publicRoutesCache: PublicRoutesCacheService,
  ) {}

  /**
   * @param context  Nest HTTP execution context.
   * @returns `true` when the caller is authorized for the route.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<IYoizenRequest>();
    const method: string = request.method;
    const url: string = request.url.split("?")[0];

    const publicRoutes = await this.publicRoutesCache.getPublicRoutes();
    if (this.publicRoutesCache.isMatch(publicRoutes, method, url)) {
      return true;
    }

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing Authorization header");
    }

    const payload = await this.jwtService.verify(token);
    request[REQUEST_USER_KEY] = payload;

    this.validateTenantScope(payload, request[REQUEST_TENANT_KEY]);

    const handlers = [context.getHandler(), context.getClass()];

    const requiredScopes = this.reflector.getAllAndOverride<
      string[] | undefined
    >(SCOPES_KEY, handlers);

    if (requiredScopes && requiredScopes.length > 0) {
      this.checkScopes(payload, requiredScopes);
    }

    const requiredPermissions = this.reflector.getAllAndOverride<
      string[] | undefined
    >(PERMISSIONS_KEY, handlers);

    if (requiredPermissions && requiredPermissions.length > 0) {
      this.checkPermissions(payload, requiredPermissions);
    }

    return true;
  }

  /** Bearer header first, then ?token= query param (for SSE / WebSocket). */
  private extractToken(request: IYoizenRequest): string | undefined {
    const rawAuth =
      request.headers.authorization ?? request.headers.Authorization;
    const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    if (typeof authHeader === "string") {
      const parts = authHeader.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") return parts[1];
    }
    const q = request.query as { token?: unknown };
    const token = q.token;
    return typeof token === "string" ? token : undefined;
  }

  private validateTenantScope(
    payload: JwtPayload,
    tenantId: string | undefined,
  ): void {
    if (!tenantId) return;

    const scope = payload.scope as string;
    if (scope === "platform") return;

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
    if (scope === "platform") return;

    const isTenant = scope.startsWith(TENANT_SCOPE_PREFIX);

    for (let i = 0; i < required.length; i++) {
      if (required[i] === "tenant" && isTenant) return;
      if (required[i] === scope) return;
    }

    throw new ForbiddenException("Insufficient scope for this resource");
  }

  private checkPermissions(payload: JwtPayload, required: string[]): void {
    const scope = payload.scope as string;
    if (scope === "platform") return;

    const perms = payload.permissions;
    if (!perms || perms.length === 0) {
      throw new ForbiddenException(
        "Insufficient permissions for this resource",
      );
    }

    const permSet = new Set(perms);
    if (permSet.has("*")) return;

    for (let i = 0; i < required.length; i++) {
      if (!permSet.has(required[i])) {
        throw new ForbiddenException(
          "Insufficient permissions for this resource",
        );
      }
    }
  }
}
