import { Controller, Get, Headers, Param, Query } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { StreamsService } from "./streams.service";
import { StreamMessagesQueryDto } from "./streams.dto";

@Controller("channels/streams")
export class StreamsController {
  constructor(private readonly streams: StreamsService) {}

  @Get()
  async list(@Headers(TENANT_HEADER) tenantId: string) {
    return { items: await this.streams.listStreams(tenantId) };
  }

  @Get(":key/messages")
  async messages(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("key") key: string,
    @Query() query: StreamMessagesQueryDto,
  ) {
    return {
      items: await this.streams.getMessages(
        tenantId,
        key,
        query.subject,
        query.limit,
        query.mode,
        query.accountId,
      ),
    };
  }
}
