import { Module } from "@nestjs/common";
import { ChannelsController } from "./channels.controller";
import { WebhooksController } from "./webhooks.controller";
import { ChannelsProxyService } from "./channels-proxy.service";
import { ChannelStreamService } from "./channel-stream.service";

@Module({
  controllers: [ChannelsController, WebhooksController],
  providers: [ChannelsProxyService, ChannelStreamService],
})
export class ChannelsModule {}
