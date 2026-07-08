import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { assertFoundOrThrow } from "../../common/audit-http.util";
import { auditPaginatedQuery } from "../../common/audit-list-helpers";
import type { ChainTreeResult } from "../audit/build-chain-tree";
// biome-ignore lint/style/useImportType: QueryChannelEventsDto is a @Query() metatype — must be a value import so ValidationPipe receives the real class at runtime, not Object.
import { QueryChannelEventsDto } from "./channel-audit.dto";
// biome-ignore lint/style/useImportType: ChannelAuditService is constructor-injected by NestJS DI — must be a value import so `design:paramtypes` metadata resolves the real class at runtime, not `type`.
import { ChannelAuditService } from "./channel-audit.service";

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
    @Query() query: QueryChannelEventsDto
  ) {
    const { channel, kind, accountId, conversationId, from, to } = query;
    return auditPaginatedQuery(query.limit, query.offset, (limit, offset) =>
      this.channelAuditService.queryEvents(
        { channel, kind, accountId, conversationId, from, to, limit, offset },
        tenantId
      )
    );
  }

  /**
   * Returns the causal-chain tree for a correlation_id.
   * Declared ABOVE @Get(":id") to prevent NestJS route shadowing.
   */
  @Get("chain/:correlationId")
  async getChannelChain(
    @TenantId() tenantId: string,
    @Param("correlationId") correlationId: string
  ): Promise<ChainTreeResult> {
    const chain = await this.channelAuditService.getChannelChain(
      correlationId,
      tenantId
    );
    return assertFoundOrThrow(
      chain,
      `Channel chain ${correlationId} not found`
    );
  }

  /**
   * Single channel audit row by id.
   */
  @Get(":id")
  async getEvent(@TenantId() tenantId: string, @Param("id") id: string) {
    const event = await this.channelAuditService.getEventById(id, tenantId);
    return assertFoundOrThrow(event, `Channel event ${id} not found`);
  }
}
