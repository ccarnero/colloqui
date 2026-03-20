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
import { TenantUsersService } from "./tenant-users.service";
import { CreateTenantUserDto, UpdateTenantUserDto } from "./tenant-user.dto";
import { TENANT_HEADER } from "@yoizen/shared";

@Controller("auth/tenant-users")
export class TenantUsersController {
  constructor(private readonly tenantUsersService: TenantUsersService) {}

  @Post()
  async create(@Body() dto: CreateTenantUserDto) {
    return this.tenantUsersService.create(
      dto.tenant_id,
      dto.email,
      dto.password,
      dto.role,
      dto.display_name,
    );
  }

  @Get()
  async list(@Headers(TENANT_HEADER) tenantId: string) {
    return this.tenantUsersService.listByTenant(tenantId);
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return this.tenantUsersService.findById(id);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateTenantUserDto) {
    return this.tenantUsersService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string) {
    return this.tenantUsersService.deactivate(id);
  }
}
