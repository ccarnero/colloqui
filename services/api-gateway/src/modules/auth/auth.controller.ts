import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../decorators/permissions.decorator";
import { Public } from "../../decorators/public.decorator";
import { Scopes } from "../../decorators/scopes.decorator";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import type { IYoizenRequest } from "../../types/yoizen-request";
// biome-ignore lint/style/useImportType: used as @Body() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import {
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
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { AuthFacadeService } from "./auth-facade.service";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authFacade: AuthFacadeService) {}

  @Public()
  @SkipTenant()
  @Post("token")
  async token(@Body() body: AuthTokenBodyDto): Promise<object> {
    return this.authFacade.token(body);
  }

  @Public()
  @SkipTenant()
  @Post("login")
  async login(@Body() body: AuthLoginBodyDto): Promise<object> {
    return this.authFacade.login(body);
  }

  @Public()
  @SkipTenant()
  @Post("refresh")
  async refresh(@Body() body: AuthRefreshBodyDto): Promise<object> {
    return this.authFacade.refreshToken(body);
  }

  @Scopes("platform")
  @Get("public-routes")
  async listPublicRoutes(
    @Req() req: IYoizenRequest,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.listPublicRoutes(req, auth);
  }

  @Scopes("platform")
  @Post("public-routes")
  async createPublicRoute(
    @Req() req: IYoizenRequest,
    @Body() body: CreatePublicRouteDto,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.createPublicRoute(req, body, auth);
  }

  @Scopes("platform")
  @Delete("public-routes/:id")
  async removePublicRoute(
    @Req() req: IYoizenRequest,
    @Param("id") id: string,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.removePublicRoute(req, id, auth);
  }

  @Scopes("platform")
  @Post("users")
  async createUser(
    @Req() req: IYoizenRequest,
    @Body() body: CreateUserBodyDto,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.createUser(req, body, auth);
  }

  @Scopes("platform")
  @Get("users")
  async listUsers(
    @Req() req: IYoizenRequest,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.listUsers(req, auth);
  }

  @Scopes("platform")
  @Post("clients")
  async createClient(
    @Req() req: IYoizenRequest,
    @Body() body: CreateClientBodyDto,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.createClient(req, body, auth);
  }

  @Scopes("platform")
  @Get("clients")
  async listClients(
    @Req() req: IYoizenRequest,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.listClients(req, auth);
  }

  @Scopes("platform")
  @Delete("clients/:id")
  async revokeClient(
    @Req() req: IYoizenRequest,
    @Param("id") id: string,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.revokeClient(req, id, auth);
  }

  @Scopes("platform", "tenant")
  @Post("tenant-users")
  async createTenantUser(
    @Req() req: IYoizenRequest,
    @Body() body: CreateTenantUserBodyDto,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.createTenantUser(req, body, auth);
  }

  @Get("tenant-users")
  async listTenantUsers(
    @Req() req: IYoizenRequest,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.listTenantUsers(req, auth);
  }

  @Get("tenant-users/:id")
  async getTenantUser(
    @Req() req: IYoizenRequest,
    @Param("id") id: string,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.getTenantUser(req, id, auth);
  }

  @Patch("tenant-users/:id")
  async updateTenantUser(
    @Req() req: IYoizenRequest,
    @Param("id") id: string,
    @Body() body: UpdateTenantUserBodyDto,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.updateTenantUser(req, id, body, auth);
  }

  @Delete("tenant-users/:id")
  async removeTenantUser(
    @Req() req: IYoizenRequest,
    @Param("id") id: string,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.removeTenantUser(req, id, auth);
  }

  @Scopes("platform", "tenant")
  @RequirePermission("roles:create")
  @Post("tenant-roles")
  async createTenantRole(
    @Req() req: IYoizenRequest,
    @Body() body: CreateTenantRoleDto,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.createTenantRole(req, body, auth);
  }

  @Scopes("platform", "tenant")
  @RequirePermission("roles:read")
  @Get("tenant-roles")
  async listTenantRoles(
    @Req() req: IYoizenRequest,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.listTenantRoles(req, auth);
  }

  @Scopes("platform", "tenant")
  @RequirePermission("roles:read")
  @Get("tenant-roles/:id")
  async getTenantRole(
    @Req() req: IYoizenRequest,
    @Param("id") id: string,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.getTenantRole(req, id, auth);
  }

  @Scopes("platform", "tenant")
  @RequirePermission("roles:update")
  @Patch("tenant-roles/:id")
  async updateTenantRole(
    @Req() req: IYoizenRequest,
    @Param("id") id: string,
    @Body() body: UpdateTenantRoleDto,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.updateTenantRole(req, id, body, auth);
  }

  @Scopes("platform", "tenant")
  @RequirePermission("roles:delete")
  @Delete("tenant-roles/:id")
  async deleteTenantRole(
    @Req() req: IYoizenRequest,
    @Param("id") id: string,
    @Headers("authorization") auth: string
  ): Promise<object> {
    return this.authFacade.deleteTenantRole(req, id, auth);
  }
}
