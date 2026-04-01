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
import type { YoizenRequest } from "../../types/yoizen-request";
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

const TENANT_SCOPE_PREFIX = "tenant:";

@Injectable()
export class AuthFacadeService {
  constructor(
    private readonly authProxy: AuthProxyService,
    private readonly tenantProxy: TenantProxyService,
  ) {}

  async token(body: AuthTokenBodyDto): Promise<object> {
    const result = await this.authProxy.proxy("POST", "/auth/token", body);
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
    return this.authProxy.proxy("POST", "/auth/login", body);
  }

  async refreshToken(body: AuthRefreshBodyDto): Promise<object> {
    return this.authProxy.proxy("POST", "/auth/refresh", body);
  }

  async listPublicRoutes(
    req: YoizenRequest,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "GET",
      "/auth/public-routes",
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async createPublicRoute(
    req: YoizenRequest,
    body: CreatePublicRouteDto,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "POST",
      "/auth/public-routes",
      body,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async removePublicRoute(
    req: YoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "DELETE",
      `/auth/public-routes/${id}`,
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async createUser(
    req: YoizenRequest,
    body: CreateUserBodyDto,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "POST",
      "/auth/users",
      body,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async listUsers(req: YoizenRequest, auth: string): Promise<object> {
    return this.authProxy.proxy(
      "GET",
      "/auth/users",
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async createClient(
    req: YoizenRequest,
    body: CreateClientBodyDto,
    auth: string,
  ): Promise<object> {
    const scope = body.scope;
    if (scope?.startsWith(TENANT_SCOPE_PREFIX)) {
      const tenantName = scope.slice(TENANT_SCOPE_PREFIX.length);
      await this.assertTenantExists(tenantName);
    }
    return this.authProxy.proxy(
      "POST",
      "/auth/clients",
      body,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async listClients(req: YoizenRequest, auth: string): Promise<object> {
    return this.authProxy.proxy(
      "GET",
      "/auth/clients",
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async revokeClient(
    req: YoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "DELETE",
      `/auth/clients/${id}`,
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async createTenantUser(
    req: YoizenRequest,
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

    return this.authProxy.proxy(
      "POST",
      "/auth/tenant-users",
      body,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async listTenantUsers(
    req: YoizenRequest,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "GET",
      "/auth/tenant-users",
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async getTenantUser(
    req: YoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "GET",
      `/auth/tenant-users/${id}`,
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async updateTenantUser(
    req: YoizenRequest,
    id: string,
    body: UpdateTenantUserBodyDto,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "PATCH",
      `/auth/tenant-users/${id}`,
      body,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async removeTenantUser(
    req: YoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "DELETE",
      `/auth/tenant-users/${id}`,
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async createTenantRole(
    req: YoizenRequest,
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

    return this.authProxy.proxy(
      "POST",
      "/auth/tenant-roles",
      body,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async listTenantRoles(
    req: YoizenRequest,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "GET",
      "/auth/tenant-roles",
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async getTenantRole(
    req: YoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "GET",
      `/auth/tenant-roles/${id}`,
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async updateTenantRole(
    req: YoizenRequest,
    id: string,
    body: UpdateTenantRoleDto,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "PATCH",
      `/auth/tenant-roles/${id}`,
      body,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
  }

  async deleteTenantRole(
    req: YoizenRequest,
    id: string,
    auth: string,
  ): Promise<object> {
    return this.authProxy.proxy(
      "DELETE",
      `/auth/tenant-roles/${id}`,
      undefined,
      { Authorization: auth },
      req[REQUEST_TENANT_KEY],
    );
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
