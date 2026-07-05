import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { isPlatformTenantRowIdParam } from "@yoizen/shared";
import { TenantProxyService } from "./tenant-proxy.service";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { CreateTenantBodyDto, UpdateTenantBodyDto } from "./tenants.dto";
import { ApiTags } from "@nestjs/swagger";

@SkipTenant()
@ApiTags("tenants")
@Controller("tenants")
export class TenantsController {
  constructor(private readonly tenantProxy: TenantProxyService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() body: CreateTenantBodyDto): Promise<object> {
    return this.tenantProxy.createTenant(body);
  }

  @Get()
  async list(): Promise<object> {
    return this.tenantProxy.listTenants();
  }

  /**
   * Resolves by platform row UUID (async provision status) or by tenant name.
   */
  @Get(":nameOrId")
  async getOne(@Param("nameOrId") nameOrId: string): Promise<object> {
    const tenant = await this.tenantProxy.getTenant(nameOrId);
    if (!tenant) {
      throw new NotFoundException(
        isPlatformTenantRowIdParam(nameOrId)
          ? `Tenant id '${nameOrId}' not found`
          : `Tenant '${nameOrId}' not found`,
      );
    }
    return tenant;
  }

  @Patch(":name")
  async update(
    @Param("name") name: string,
    @Body() body: UpdateTenantBodyDto,
  ): Promise<object> {
    const tenant = await this.tenantProxy.updateTenant(name, body);
    if (!tenant) throw new NotFoundException(`Tenant '${name}' not found`);
    return tenant;
  }

  @Delete(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("name") name: string): Promise<void> {
    const found = await this.tenantProxy.deleteTenant(name);
    if (!found) throw new NotFoundException(`Tenant '${name}' not found`);
  }
}
