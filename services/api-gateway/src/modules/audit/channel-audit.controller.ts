import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  NotFoundException,
} from "@nestjs/common";
import { AuditProxyService } from "./audit.service";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";

@Controller("audit/channel-events")
export class ChannelAuditProxyController {
  constructor(private readonly auditProxy: AuditProxyService) {}

  @Get()
  async queryChannelEvents(
    @Req() req: any,
    @Query("channel") channel?: string,
    @Query("kind") kind?: string,
    @Query("accountId") accountId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<object> {
    return this.auditProxy.queryChannelEvents(
      { channel, kind, accountId, from, to, limit, offset },
      req[REQUEST_TENANT_KEY],
    );
  }

  @Get(":id")
  async getChannelEvent(
    @Req() req: any,
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
