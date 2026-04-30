import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  NotFoundException,
} from "@nestjs/common";
import { AuditProxyService } from "./audit-proxy.service";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { QueryChannelEventsProxyDto } from "./audit-proxy-query.dto";
import { channelEventsToParams } from "./audit-query-params.util";

@Controller("audit/channel-events")
export class ChannelAuditProxyController {
  constructor(private readonly auditProxy: AuditProxyService) {}

  @Get()
  async queryChannelEvents(
    @Req() req: ITenantScopedRequest,
    @Query() query: QueryChannelEventsProxyDto,
  ): Promise<object> {
    return this.auditProxy.queryChannelEvents(
      channelEventsToParams(query),
      req[REQUEST_TENANT_KEY],
    );
  }

  @Get(":id")
  async getChannelEvent(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ): Promise<object> {
    const event = await this.auditProxy.getChannelEventById(
      id,
      req[REQUEST_TENANT_KEY],
    );
    if (!event) {
      throw new NotFoundException(`Channel event ${id} not found`);
    }
    return event;
  }
}
