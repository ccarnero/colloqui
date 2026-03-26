import { Module } from "@nestjs/common";
import { ChannelsController } from "./channels.controller";
import { WebhooksController } from "./webhooks.controller";
import { ChannelsProxyService } from "./channels-proxy.service";

@Module({
  controllers: [ChannelsController, WebhooksController],
  providers: [ChannelsProxyService],
})
export class ChannelsModule {}
