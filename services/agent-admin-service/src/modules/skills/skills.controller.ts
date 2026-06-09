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
import { SkillsService } from "./skills.service";
import { CreateSkillDto, UpdateSkillDto } from "./skills.dto";

@Controller("admin/skills")
@UseGuards(TenantGuard)
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@TenantId() tenantId: string) {
    return this.skillsService.findAll(tenantId);
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ) {
    return this.skillsService.findById(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() body: CreateSkillDto,
  ) {
    return this.skillsService.create(tenantId, body);
  }

  @Patch(":id")
  @HttpCode(HttpStatus.OK)
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() body: UpdateSkillDto,
  ) {
    return this.skillsService.update(tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ) {
    return this.skillsService.delete(tenantId, id);
  }
}
