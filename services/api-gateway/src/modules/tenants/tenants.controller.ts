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
import { TenantProxyService } from "./tenant-proxy.service";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { CreateTenantBodyDto, UpdateTenantBodyDto } from "./tenants.dto";

@SkipTenant()
@Controller("tenants")
export class TenantsController {
  constructor(private readonly tenantProxy: TenantProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateTenantBodyDto): Promise<object> {
    return this.tenantProxy.createTenant(body);
  }

  @Get()
  async list(): Promise<object> {
    return this.tenantProxy.listTenants();
  }

  @Get(":name")
  async get(@Param("name") name: string): Promise<object> {
    const tenant = await this.tenantProxy.getTenant(name);
    if (!tenant) throw new NotFoundException(`Tenant '${name}' not found`);
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
