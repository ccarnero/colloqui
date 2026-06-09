import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AdaptersService } from "./adapters.service";
import type { AdapterSummaryDto, AdapterDetailDto } from "./adapters.dto";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

@Controller("admin/adapters")
@UseGuards(TenantGuard)
export class AdaptersController {
  constructor(private readonly adaptersService: AdaptersService) {}

  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @Query("tag") tag?: string,
  ): Promise<{ adapters: AdapterSummaryDto[] }> {
    return this.adaptersService.findAll(tenantId, tag);
  }

  @Get(":adapterId")
  async findOne(
    @TenantId() tenantId: string,
    @Param("adapterId") adapterId: string,
  ): Promise<AdapterDetailDto> {
    return this.adaptersService.findOneOrThrow(tenantId, adapterId);
  }
}
