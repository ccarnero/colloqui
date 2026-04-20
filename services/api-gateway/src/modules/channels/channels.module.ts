import { Module } from "@nestjs/common";
import { ChannelsController } from "./channels.controller";
import { WebhooksController } from "./webhooks.controller";
import { ChannelsProxyService } from "./channels-proxy.service";
import { ChannelStreamService } from "./channel-stream.service";
import { WebhookIngressPublisherService } from "./webhook-ingress-publisher.service";
import { WebhookVerifyRpcClient } from "./webhook-verify-rpc.client";

@Module({
  controllers: [ChannelsController, WebhooksController],
  providers: [
    ChannelsProxyService,
    ChannelStreamService,
    WebhookIngressPublisherService,
    WebhookVerifyRpcClient,
  ],
})
export class ChannelsModule {}
