import { forwardRef, Module } from "@nestjs/common";
import { ChannelRouter } from "../../providers/channel-router";
import { E2eTestsModule } from "../../providers/e2e-tests/e2e-tests.module";
import { HttpModule } from "../../providers/http/http.module";
import { InstagramProvider } from "../../providers/meta/instagram/instagram.provider";
import { ProviderRegistry } from "../../providers/meta/provider-registry";
import { WhatsAppProvider } from "../../providers/meta/whatsapp/whatsapp.provider";
import { TelegramModule } from "../../providers/telegram/telegram.module";
import { AccountsModule } from "../accounts/accounts.module";
import { IngressModule } from "../ingress/ingress.module";
import { WebhookIngressService } from "./webhook-ingress.service";
import { WebhookIngressConsumerService } from "./webhook-ingress-consumer.service";
import { WebhookVerifyRpcServer } from "./webhook-verify-rpc.server";

@Module({
  imports: [
    forwardRef(() => IngressModule),
    forwardRef(() => AccountsModule),
    TelegramModule,
    HttpModule,
    E2eTestsModule,
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
    E2eTestsModule,
  ],
})
export class WebhooksModule {}
