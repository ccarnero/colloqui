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
import { KnowledgeBasesService } from "./knowledge-bases.service";
import {
  CreateKnowledgeBaseDto,
  UpdateKnowledgeBaseDto,
} from "./knowledge-bases.dto";

@Controller("admin/knowledge-bases")
@UseGuards(TenantGuard)
export class KnowledgeBasesController {
  constructor(private readonly service: KnowledgeBasesService) {}

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
  async create(
    @TenantId() tenantId: string,
    @Body() body: CreateKnowledgeBaseDto,
  ) {
    return this.service.create(tenantId, body);
  }

  @Patch(":id")
  @HttpCode(HttpStatus.OK)
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() body: UpdateKnowledgeBaseDto,
  ) {
    return this.service.update(tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async delete(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.service.delete(tenantId, id);
  }
}
