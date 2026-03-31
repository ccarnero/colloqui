import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
} from "@nestjs/common";
import { AdaptersService } from "./adapters.service";
import type { AdapterSummaryDto, AdapterDetailDto } from "./adapters.dto";
import { TenantGuard } from "../../providers/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

@Controller("admin/adapters")
@UseGuards(TenantGuard)
export class AdaptersController {
  constructor(private readonly adaptersService: AdaptersService) {}

  @Get()
  async findAll(
    @TenantId() tenantId: string,
  ): Promise<{ adapters: AdapterSummaryDto[] }> {
    return this.adaptersService.findAll(tenantId);
  }

  @Get(":adapterId")
  async findOne(
    @TenantId() tenantId: string,
    @Param("adapterId") adapterId: string,
  ): Promise<AdapterDetailDto> {
    const adapter = await this.adaptersService.findOne(tenantId, adapterId);
    if (!adapter) {
      throw new NotFoundException(
        `Adapter '${adapterId}' not found`,
      );
    }
    return adapter;
  }
}
