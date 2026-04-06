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
    const { type, from, to } = query;
    return auditPaginatedQuery(query.limit, query.offset, (limit, offset) =>
      this.auditService.queryEvents(
        { type, from, to, limit, offset },
        tenantId,
      ),
    );
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
