import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";
import { SystemVariablesService } from "./system-variables.service";
import { CreateSystemVariableDto, UpdateSystemVariableDto } from "./system-variables.dto";

@Controller("admin/system-variables")
@UseGuards(TenantGuard)
export class SystemVariablesController {
  constructor(private readonly service: SystemVariablesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@TenantId() tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  async findById(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.service.findById(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@TenantId() tenantId: string, @Body() body: CreateSystemVariableDto) {
    return this.service.create(tenantId, body);
  }

  @Patch(":id")
  @HttpCode(HttpStatus.OK)
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() body: UpdateSystemVariableDto,
  ) {
    return this.service.update(tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async delete(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.service.delete(tenantId, id);
  }
}
