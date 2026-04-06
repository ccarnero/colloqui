import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AdaptersService } from "./adapters.service";
import type { AdapterSummaryDto, AdapterDetailDto } from "./adapters.dto";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

/** Proxies adapter-service data for YoizenClaw admin UI. */
@Controller("admin/adapters")
@UseGuards(TenantGuard)
export class AdaptersController {
  constructor(private readonly adaptersService: AdaptersService) {}

  /**
   * Lists adapter summaries for dropdowns in the admin UI.
   *
   * @param tenantId - Resolved from `x-yoizen-tenant`.
   */
  @Get()
  async findAll(
    @TenantId() tenantId: string,
  ): Promise<{ adapters: AdapterSummaryDto[] }> {
    return this.adaptersService.findAll(tenantId);
  }

  /**
   * Returns a single adapter with endpoints for tool configuration.
   *
   * @param tenantId - Tenant scope.
   * @param adapterId - Adapter id.
   */
  @Get(":adapterId")
  async findOne(
    @TenantId() tenantId: string,
    @Param("adapterId") adapterId: string,
  ): Promise<AdapterDetailDto> {
    return this.adaptersService.findOneOrThrow(tenantId, adapterId);
  }
}
