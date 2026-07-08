import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { assertFoundOrThrow } from "../../common/audit-http.util";
import { auditPaginatedQuery } from "../../common/audit-list-helpers";
import type { QueryExecutionEventsDto } from "./execution-audit.dto";
// biome-ignore lint/style/useImportType: ExecutionAuditService is constructor-injected by NestJS DI — must be a value import so `design:paramtypes` metadata resolves the real class at runtime, not `type`.
import { ExecutionAuditService } from "./execution-audit.service";

@Controller("audit/execution-events")
@UseGuards(TenantGuard)
export class ExecutionAuditController {
  constructor(private readonly executionAuditService: ExecutionAuditService) {}

  /**
   * Paginated execution lifecycle audit events (started/completed/failed).
   */
  @Get()
  async queryEvents(
    @TenantId() tenantId: string,
    @Query() query: QueryExecutionEventsDto
  ) {
    const { executionId, conversationId, agentId, from, to } = query;
    return auditPaginatedQuery(query.limit, query.offset, (limit, offset) =>
      this.executionAuditService.queryEvents(
        { executionId, conversationId, agentId, from, to, limit, offset },
        tenantId
      )
    );
  }

  /**
   * Single execution audit row by id.
   */
  @Get(":id")
  async getEvent(@TenantId() tenantId: string, @Param("id") id: string) {
    const event = await this.executionAuditService.getEventById(id, tenantId);
    return assertFoundOrThrow(event, `Execution event ${id} not found`);
  }
}
