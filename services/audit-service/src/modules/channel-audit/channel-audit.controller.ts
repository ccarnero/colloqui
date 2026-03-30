import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ChannelAuditService } from "./channel-audit.service";
import { TENANT_HEADER } from "@yoizen/shared";

@Controller("audit/channel-events")
export class ChannelAuditController {
  constructor(
    private readonly channelAuditService: ChannelAuditService,
  ) {}

  @Get()
  async queryEvents(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query("channel") channel?: string,
    @Query("kind") kind?: string,
    @Query("accountId") accountId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limitStr?: string,
    @Query("offset") offsetStr?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException("Missing x-yoizen-tenant header");
    }

    const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 500);
    const offset = Math.max(Number(offsetStr) || 0, 0);

    const events = await this.channelAuditService.queryEvents(
      { channel, kind, accountId, from, to, limit, offset },
      tenantId,
    );

    return { events, limit, offset };
  }

  @Get(":id")
  async getEvent(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") id: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException("Missing x-yoizen-tenant header");
    }

    const event = await this.channelAuditService.getEventById(
      id,
      tenantId,
    );
    if (!event) {
      throw new NotFoundException(
        `Channel event ${id} not found`,
      );
    }
    return event;
  }
}
