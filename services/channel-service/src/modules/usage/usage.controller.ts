import { Controller, Get, Headers, Query } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { UsageService } from "./usage.service";
import { UsageQueryDto, UsageTotalsQueryDto } from "./usage.dto";

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
    @Query() query: UsageQueryDto,
  ) {
    return { items: await this.usage.getUsage(tenantId, query) };
  }

  @Get("totals")
  async totals(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: UsageTotalsQueryDto,
  ) {
    return { items: await this.usage.getUsageTotals(tenantId, query) };
  }
}
