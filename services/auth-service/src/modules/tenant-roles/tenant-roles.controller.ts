import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { requireTenantHeader } from "../../common/require-tenant-header";
import { TenantRolesService } from "./tenant-roles.service";
import { CreateTenantRoleDto, UpdateTenantRoleDto } from "./tenant-role.dto";
import { TENANT_HEADER } from "@yoizen/shared";

@Controller("auth/tenant-roles")
export class TenantRolesController {
  constructor(private readonly tenantRolesService: TenantRolesService) {}

  @Post()
  async create(@Body() dto: CreateTenantRoleDto) {
    return this.tenantRolesService.create({
      tenantId: dto.tenant_id,
      name: dto.name,
      description: dto.description,
      permissions: dto.permissions,
    });
  }

  @Get()
  async list(@Headers(TENANT_HEADER) tenantId: string | undefined) {
    return this.tenantRolesService.listByTenant(requireTenantHeader(tenantId));
  }

  @Get(":id")
  async findOne(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") id: string,
  ) {
    return this.tenantRolesService.getWithPermissions(
      requireTenantHeader(tenantId),
      id,
    );
  }

  @Patch(":id")
  async update(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") id: string,
    @Body() dto: UpdateTenantRoleDto,
  ) {
    return this.tenantRolesService.update(
      requireTenantHeader(tenantId),
      id,
      dto,
    );
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") id: string,
  ) {
    return this.tenantRolesService.delete(requireTenantHeader(tenantId), id);
  }
}
