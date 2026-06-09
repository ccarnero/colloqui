import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";
import { SKBContainersService } from "./containers.service";
import { CreateSKBDto } from "./dto/create-skb.dto";
import { UpdateSKBDto } from "./dto/update-skb.dto";
import type { SKBContainerRow } from "./types/skb.types";

@Controller("admin/structured-kb/containers")
@UseGuards(TenantGuard)
export class SKBContainersController {
  constructor(private readonly service: SKBContainersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateSKBDto,
  ): Promise<SKBContainerRow> {
    return this.service.createContainer(tenantId, dto.name, dto.description);
  }

  @Get()
  async list(
    @TenantId() tenantId: string,
  ): Promise<SKBContainerRow[]> {
    return this.service.listContainers(tenantId);
  }

  @Get(":id")
  async get(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<SKBContainerRow> {
    return this.service.getContainer(tenantId, id);
  }

  @Patch(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateSKBDto,
  ): Promise<SKBContainerRow> {
    return this.service.updateContainer(tenantId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.deleteContainer(tenantId, id);
  }
}
