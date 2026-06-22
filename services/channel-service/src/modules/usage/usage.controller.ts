import { Controller, Get, Headers, Query } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { UsageQueryDto, UsageTotalsQueryDto } from "./usage.dto";
import { UsageService } from "./usage.service";

/**
 * Read-only usage endpoints. Served from the per-tenant
 * TimescaleDB continuous aggregates — O(chunks) per response
 * regardless of raw event volume.
 *
 * `tenantId` is passed through `x-yoizen-tenant` by api-gateway.
 */
@Controller("channels/usage")
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async list(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: UsageQueryDto
  ) {
    return { items: await this.usage.getUsage(tenantId, query) };
  }

  /**
   * 24-hour rolling summary: total counts per direction + per-channel
   * breakdown. Declared before `@Get('totals')` to avoid route shadowing.
   */
  @Get("summary")
  async summary(@Headers(TENANT_HEADER) tenantId: string) {
    return this.usage.getUsageSummary(tenantId);
  }

  @Get("totals")
  async totals(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: UsageTotalsQueryDto
  ) {
    return { items: await this.usage.getUsageTotals(tenantId, query) };
  }
}
