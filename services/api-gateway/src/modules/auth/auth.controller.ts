import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import type { JwtPayload } from '@yoizen/shared';
import { AuthProxyService } from './auth-proxy.service';
import { TenantProxyService } from '../tenants/tenant-proxy.service';
import { Public } from '../../decorators/public.decorator';
import { Scopes } from '../../decorators/scopes.decorator';
import { SkipTenant } from '../../decorators/skip-tenant.decorator';
import { REQUEST_USER_KEY } from '../../guards/auth.guard';
import { REQUEST_TENANT_KEY } from '../../guards/tenant.guard';

const TENANT_SCOPE_PREFIX = 'tenant:';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authProxy: AuthProxyService,
    private readonly tenantProxy: TenantProxyService,
  ) {}

  @Public()
  @SkipTenant()
  @Post('token')
  async token(@Body() body: object): Promise<object> {
    const result = await this.authProxy.proxy('POST', '/auth/token', body);
    const scope = (result as Record<string, unknown>).scope as string | undefined;
    if (scope?.startsWith(TENANT_SCOPE_PREFIX)) {
      const tenantName = scope.slice(TENANT_SCOPE_PREFIX.length);
      await this.assertTenantExists(tenantName);
    }
    return result;
  }

  @Public()
  @SkipTenant()
  @Post('login')
  async login(@Body() body: object): Promise<object> {
    return this.authProxy.proxy('POST', '/auth/login', body);
  }

  @Public()
  @SkipTenant()
  @Post('refresh')
  async refresh(@Body() body: object): Promise<object> {
    return this.authProxy.proxy('POST', '/auth/refresh', body);
  }

  @Scopes('platform')
  @Get('public-routes')
  async listPublicRoutes(
    @Req() req: any,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('GET', '/auth/public-routes', undefined, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Scopes('platform')
  @Post('public-routes')
  async createPublicRoute(
    @Req() req: any,
    @Body() body: object,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('POST', '/auth/public-routes', body, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Scopes('platform')
  @Delete('public-routes/:id')
  async removePublicRoute(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('DELETE', `/auth/public-routes/${id}`, undefined, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Scopes('platform')
  @Post('users')
  async createUser(
    @Req() req: any,
    @Body() body: object,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('POST', '/auth/users', body, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Scopes('platform')
  @Get('users')
  async listUsers(
    @Req() req: any,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('GET', '/auth/users', undefined, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Scopes('platform')
  @Post('clients')
  async createClient(
    @Req() req: any,
    @Body() body: object,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    const scope = (body as Record<string, unknown>).scope as string | undefined;
    if (scope?.startsWith(TENANT_SCOPE_PREFIX)) {
      const tenantName = scope.slice(TENANT_SCOPE_PREFIX.length);
      await this.assertTenantExists(tenantName);
    }
    return this.authProxy.proxy('POST', '/auth/clients', body, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Scopes('platform')
  @Get('clients')
  async listClients(
    @Req() req: any,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('GET', '/auth/clients', undefined, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Scopes('platform')
  @Delete('clients/:id')
  async revokeClient(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('DELETE', `/auth/clients/${id}`, undefined, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Scopes('platform', 'tenant')
  @Post('tenant-users')
  async createTenantUser(
    @Req() req: any,
    @Body() body: object,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    const user = req[REQUEST_USER_KEY] as JwtPayload;
    const record = body as Record<string, unknown>;
    const tenantId = record.tenant_id as string | undefined;

    if (user.scope !== 'platform') {
      if (user.role !== 'tenant_admin') {
        throw new ForbiddenException(
          'Only tenant administrators can create users',
        );
      }
      const scopeTenant = (user.scope as string).slice(
        TENANT_SCOPE_PREFIX.length,
      );
      if (tenantId && tenantId !== scopeTenant) {
        throw new ForbiddenException(
          'Cannot create users for a different tenant',
        );
      }
      if (!tenantId) {
        record.tenant_id = scopeTenant;
      }
    }

    if (record.tenant_id) {
      await this.assertTenantExists(record.tenant_id as string);
    }

    return this.authProxy.proxy('POST', '/auth/tenant-users', body, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Get('tenant-users')
  async listTenantUsers(
    @Req() req: any,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('GET', '/auth/tenant-users', undefined, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Get('tenant-users/:id')
  async getTenantUser(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('GET', `/auth/tenant-users/${id}`, undefined, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Patch('tenant-users/:id')
  async updateTenantUser(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: object,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('PATCH', `/auth/tenant-users/${id}`, body, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
  }

  @Delete('tenant-users/:id')
  async removeTenantUser(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('authorization') auth: string,
  ): Promise<object> {
    return this.authProxy.proxy('DELETE', `/auth/tenant-users/${id}`, undefined, {
      Authorization: auth,
    }, req[REQUEST_TENANT_KEY]);
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
