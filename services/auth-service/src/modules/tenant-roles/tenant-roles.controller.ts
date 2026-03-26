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
import { TenantRolesService } from "./tenant-roles.service";
import { CreateTenantRoleDto, UpdateTenantRoleDto } from "./tenant-role.dto";
import { TENANT_HEADER } from "@yoizen/shared";

@Controller("auth/tenant-roles")
export class TenantRolesController {
  constructor(private readonly tenantRolesService: TenantRolesService) {}

  @Post()
  async create(@Body() dto: CreateTenantRoleDto) {
    return this.tenantRolesService.create(
      dto.tenant_id,
      dto.name,
      dto.description,
      dto.permissions,
    );
  }

  @Get()
  async list(@Headers(TENANT_HEADER) tenantId: string) {
    return this.tenantRolesService.listByTenant(tenantId);
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return this.tenantRolesService.getWithPermissions(id);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateTenantRoleDto) {
    return this.tenantRolesService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string) {
    return this.tenantRolesService.delete(id);
  }
}
