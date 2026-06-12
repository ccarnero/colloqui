import { Module, forwardRef } from "@nestjs/common";
import { WebhookIngressService } from "./webhook-ingress.service";
import { WebhookIngressConsumerService } from "./webhook-ingress-consumer.service";
import { WebhookVerifyRpcServer } from "./webhook-verify-rpc.server";
import { WhatsAppProvider } from "../../providers/meta/whatsapp/whatsapp.provider";
import { InstagramProvider } from "../../providers/meta/instagram/instagram.provider";
import { ProviderRegistry } from "../../providers/meta/provider-registry";
import { TelegramModule } from "../../providers/telegram/telegram.module";
import { HttpModule } from "../../providers/http/http.module";
import { ChannelRouter } from "../../providers/channel-router";
import { IngressModule } from "../ingress/ingress.module";
import { AccountsModule } from "../accounts/accounts.module";

@Module({
  imports: [
    forwardRef(() => IngressModule),
    forwardRef(() => AccountsModule),
    TelegramModule,
    HttpModule,
  ],
  providers: [
    WebhookIngressService,
    WebhookIngressConsumerService,
    WebhookVerifyRpcServer,
    WhatsAppProvider,
    InstagramProvider,
    ProviderRegistry,
    ChannelRouter,
  ],
  exports: [
    ChannelRouter,
    ProviderRegistry,
    WhatsAppProvider,
    InstagramProvider,
    TelegramModule,
    HttpModule,
  ],
})
export class WebhooksModule {}
