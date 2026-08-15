import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";
import {
  SystemVariableConflictError,
  SystemVariablesService,
} from "./system-variables.service";
import { CreateSystemVariableDto, UpdateSystemVariableDto } from "./system-variables.dto";

@Controller("admin/system-variables")
@UseGuards(TenantGuard)
export class SystemVariablesController {
  private readonly logger = new Logger(SystemVariablesController.name);

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
    try {
      // Creates, or reactivates a soft-deleted variable with the same name —
      // both resolve to the usual 201 payload.
      return await this.service.create(tenantId, body);
    } catch (err) {
      if (err instanceof SystemVariableConflictError) {
        this.logger.warn(
          `409 on create: system variable '${err.variableName}' is already active for tenant ${tenantId}`
        );
        throw new ConflictException(
          `System variable '${err.variableName}' already exists`
        );
      }
      throw err;
    }
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
