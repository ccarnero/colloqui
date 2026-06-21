import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { assertFoundOrThrow } from "../../common/audit-http.util";
import { auditPaginatedQuery } from "../../common/audit-list-helpers";
import { TenantGuard, TenantId } from "@yoizen/database";
import { AuditService } from "./audit.service";
import { QueryEventsDto } from "./audit.dto";

@Controller("audit/events")
@UseGuards(TenantGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Lists persisted events with optional type/date filters and pagination.
   */
  @Get()
  async queryEvents(
    @TenantId() tenantId: string,
    @Query() query: QueryEventsDto,
  ) {
    const { type, from, to, correlation_id } = query;
    return auditPaginatedQuery(query.limit, query.offset, (limit, offset) =>
      this.auditService.queryEvents(
        { type, from, to, correlation_id, limit, offset },
        tenantId,
      ),
    );
  }

  /**
   * Returns the causal-chain tree for a correlation_id.
   * Declared ABOVE @Get(":id") to prevent NestJS route shadowing.
   */
  @Get("chain/:correlationId")
  async getChain(
    @TenantId() tenantId: string,
    @Param("correlationId") correlationId: string,
  ) {
    const chain = await this.auditService.getChain(correlationId, tenantId);
    return assertFoundOrThrow(chain, `Chain ${correlationId} not found`);
  }

  /**
   * Returns a single event by id or 404 via {@link assertFoundOrThrow}.
   */
  @Get(":id")
  async getEvent(@TenantId() tenantId: string, @Param("id") id: string) {
    const event = await this.auditService.getEventById(id, tenantId);
    return assertFoundOrThrow(event, `Event ${id} not found`);
  }
}
