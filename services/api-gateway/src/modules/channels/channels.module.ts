import { Module } from "@nestjs/common";
import { ChannelStreamService } from "./channel-stream.service";
import { ChannelsController } from "./channels.controller";
import { ChannelsProxyService } from "./channels-proxy.service";
import { WebhookIngressPublisherService } from "./webhook-ingress-publisher.service";
import { WebhooksController } from "./webhooks.controller";

@Module({
  controllers: [ChannelsController, WebhooksController],
  providers: [
    ChannelsProxyService,
    ChannelStreamService,
    WebhookIngressPublisherService,
  ],
})
export class ChannelsModule {}
