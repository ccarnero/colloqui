import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { assertFoundOrThrow } from "../../common/audit-http.util";
import { auditPaginatedQuery } from "../../common/audit-list-helpers";
import { TenantGuard, TenantId } from "@yoizen/database";
import { ChannelAuditService } from "./channel-audit.service";
import { QueryChannelEventsDto } from "./channel-audit.dto";

@Controller("audit/channel-events")
@UseGuards(TenantGuard)
export class ChannelAuditController {
  constructor(private readonly channelAuditService: ChannelAuditService) {}

  /**
   * Paginated channel message audit events.
   */
  @Get()
  async queryEvents(
    @TenantId() tenantId: string,
    @Query() query: QueryChannelEventsDto,
  ) {
    const { channel, kind, accountId, from, to } = query;
    return auditPaginatedQuery(query.limit, query.offset, (limit, offset) =>
      this.channelAuditService.queryEvents(
        { channel, kind, accountId, from, to, limit, offset },
        tenantId,
      ),
    );
  }

  /**
   * Single channel audit row by id.
   */
  @Get(":id")
  async getEvent(@TenantId() tenantId: string, @Param("id") id: string) {
    const event = await this.channelAuditService.getEventById(id, tenantId);
    return assertFoundOrThrow(
      event,
      `Channel event ${id} not found`,
    );
  }
}
