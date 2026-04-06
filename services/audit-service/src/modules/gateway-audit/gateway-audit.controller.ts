import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { assertFoundOrThrow } from "../../common/audit-http.util";
import { auditPaginatedQuery } from "../../common/audit-list-helpers";
import { TenantGuard, TenantId } from "@yoizen/database";
import { GatewayAuditService } from "./gateway-audit.service";
import { QueryGatewayEventsDto } from "./gateway-audit.dto";

@Controller("audit/gateway")
@UseGuards(TenantGuard)
export class GatewayAuditController {
  constructor(private readonly gatewayAuditService: GatewayAuditService) {}

  /**
   * Aggregated gateway request metrics for the tenant dashboard.
   */
  @Get("stats")
  async getDashboardStats(@TenantId() tenantId: string) {
    return this.gatewayAuditService.getDashboardStats(tenantId);
  }

  /**
   * Paginated gateway audit events with optional filters.
   */
  @Get()
  async queryEvents(
    @TenantId() tenantId: string,
    @Query() query: QueryGatewayEventsDto,
  ) {
    const { method, routeType, from, to } = query;
    return auditPaginatedQuery(query.limit, query.offset, (limit, offset) =>
      this.gatewayAuditService.queryEvents(
        { method, routeType, from, to, limit, offset },
        tenantId,
      ),
    );
  }

  /**
   * Single gateway audit row by Meta/request id.
   */
  @Get(":requestId")
  async getEvent(
    @TenantId() tenantId: string,
    @Param("requestId") requestId: string,
  ) {
    const event = await this.gatewayAuditService.getEventByRequestId(
      requestId,
      tenantId,
    );
    return assertFoundOrThrow(
      event,
      `Gateway audit event ${requestId} not found`,
    );
  }
}
