import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { SYSTEM_ROLE_TENANT_ADMIN, type JwtPayload } from "@yoizen/shared";
import { AuthProxyService } from "./auth-proxy.service";
import { TenantProxyService } from "../tenants/tenant-proxy.service";
import { REQUEST_USER_KEY } from "../../guards/auth.guard";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { IYoizenRequest } from "../../types/yoizen-request";
import type {
  AuthLoginBodyDto,
  AuthRefreshBodyDto,
  AuthTokenBodyDto,
  CreateClientBodyDto,
  CreatePublicRouteDto,
  CreateTenantRoleDto,
  CreateTenantUserBodyDto,
  CreateUserBodyDto,
  UpdateTenantRoleDto,
  UpdateTenantUserBodyDto,
} from "./auth.dto";

import { TENANT_SCOPE_PREFIX } from "../../constants";

/** Options for {@link AuthFacadeService.proxyWithTenantAuth}. */
interface IProxyWithTenantAuthOptions {
  readonly req: IYoizenRequest;
  readonly auth: string;
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

@Injectable()
export class AuthFacadeService {
  constructor(
    private readonly authProxy: AuthProxyService,
    private readonly tenantProxy: TenantProxyService,
  ) {}

  async token(body: AuthTokenBodyDto): Promise<object> {
    const result = await this.authProxy.proxy({
      method: "POST",
      path: "/auth/token",
      body,
    });
    const scope = (result as Record<string, unknown>).scope as
      | string
      | undefined;
    if (scope?.startsWith(TENANT_SCOPE_PREFIX)) {
      const tenantName = scope.slice(TENANT_SCOPE_PREFIX.length);
      await this.assertTenantExists(tenantName);
    }
    return result;
  }

  async login(body: AuthLoginBodyDto): Promise<object> {
    return this.authProxy.proxy({ method: "POST", path: "/auth/login", body });
  }

  async refreshToken(body: AuthRefreshBodyDto): Promise<object> {
    return this.authProxy.proxy({ method: "POST", path: "/auth/refresh", body });
  }

  async listPublicRoutes(req: IYoizenRequest, auth: string): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "GET",
      path: "/auth/public-routes",
    });
  }

  async createPublicRoute(
    req: IYoizenRequest,
    body: CreatePublicRouteDto,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "POST",
      path: "/auth/public-routes",
      body,
    });
  }

  async removePublicRoute(
    req: IYoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "DELETE",
      path: `/auth/public-routes/${id}`,
    });
  }

  async createUser(
    req: IYoizenRequest,
    body: CreateUserBodyDto,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "POST",
      path: "/auth/users",
      body,
    });
  }

  async listUsers(req: IYoizenRequest, auth: string): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "GET",
      path: "/auth/users",
    });
  }

  async createClient(
    req: IYoizenRequest,
    body: CreateClientBodyDto,
    auth: string,
  ): Promise<object> {
    const scope = body.scope;
    if (scope?.startsWith(TENANT_SCOPE_PREFIX)) {
      const tenantName = scope.slice(TENANT_SCOPE_PREFIX.length);
      await this.assertTenantExists(tenantName);
    }
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "POST",
      path: "/auth/clients",
      body,
    });
  }

  async listClients(req: IYoizenRequest, auth: string): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "GET",
      path: "/auth/clients",
    });
  }

  async revokeClient(
    req: IYoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "DELETE",
      path: `/auth/clients/${id}`,
    });
  }

  async createTenantUser(
    req: IYoizenRequest,
    body: CreateTenantUserBodyDto,
    auth: string,
  ): Promise<object> {
    const user = req[REQUEST_USER_KEY] as JwtPayload;

    if (user.scope !== "platform") {
      if (user.role !== SYSTEM_ROLE_TENANT_ADMIN) {
        throw new ForbiddenException(
          "Only tenant administrators can create users",
        );
      }
      const scopeTenant = (user.scope as string).slice(
        TENANT_SCOPE_PREFIX.length,
      );
      if (body.tenant_id && body.tenant_id !== scopeTenant) {
        throw new ForbiddenException(
          "Cannot create users for a different tenant",
        );
      }
      if (!body.tenant_id) {
        body.tenant_id = scopeTenant;
      }
    }

    if (body.tenant_id) {
      await this.assertTenantExists(body.tenant_id);
    }

    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "POST",
      path: "/auth/tenant-users",
      body,
    });
  }

  async listTenantUsers(req: IYoizenRequest, auth: string): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "GET",
      path: "/auth/tenant-users",
    });
  }

  async getTenantUser(
    req: IYoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "GET",
      path: `/auth/tenant-users/${id}`,
    });
  }

  async updateTenantUser(
    req: IYoizenRequest,
    id: string,
    body: UpdateTenantUserBodyDto,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "PATCH",
      path: `/auth/tenant-users/${id}`,
      body,
    });
  }

  async removeTenantUser(
    req: IYoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "DELETE",
      path: `/auth/tenant-users/${id}`,
    });
  }

  async createTenantRole(
    req: IYoizenRequest,
    body: CreateTenantRoleDto,
    auth: string,
  ): Promise<object> {
    const user = req[REQUEST_USER_KEY] as JwtPayload;

    if (user.scope !== "platform" && !body.tenant_id) {
      const scopeTenant = (user.scope as string).slice(
        TENANT_SCOPE_PREFIX.length,
      );
      body.tenant_id = scopeTenant;
    }

    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "POST",
      path: "/auth/tenant-roles",
      body,
    });
  }

  async listTenantRoles(req: IYoizenRequest, auth: string): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "GET",
      path: "/auth/tenant-roles",
    });
  }

  async getTenantRole(
    req: IYoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "GET",
      path: `/auth/tenant-roles/${id}`,
    });
  }

  async updateTenantRole(
    req: IYoizenRequest,
    id: string,
    body: UpdateTenantRoleDto,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "PATCH",
      path: `/auth/tenant-roles/${id}`,
      body,
    });
  }

  async deleteTenantRole(
    req: IYoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.proxyWithTenantAuth({
      req,
      auth,
      method: "DELETE",
      path: `/auth/tenant-roles/${id}`,
    });
  }

  /**
   * Proxies to auth-service with bearer token and resolved tenant header.
   */
  private proxyWithTenantAuth(
    options: IProxyWithTenantAuthOptions,
  ): Promise<object> {
    const { req, auth, method, path, body } = options;
    return this.authProxy.proxy({
      method,
      path,
      headers: { Authorization: auth },
      tenantId: req[REQUEST_TENANT_KEY],
      ...(body !== undefined && body !== null ? { body } : {}),
    });
  }

  private async assertTenantExists(name: string): Promise<void> {
    const tenant = await this.tenantProxy.getTenant(name);
    if (!tenant) {
      throw new BadRequestException(
        `Tenant '${name}' does not exist in this environment`,
      );
    }
  }
}
