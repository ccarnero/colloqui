import { Module, forwardRef } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { WhatsAppProvider } from "../../providers/meta/whatsapp/whatsapp.provider";
import { InstagramProvider } from "../../providers/meta/instagram/instagram.provider";
import { ProviderRegistry } from "../../providers/meta/provider-registry";
import { TelegramModule } from "../../providers/telegram/telegram.module";
import { ChannelRouter } from "../../providers/channel-router";
import { IngressModule } from "../ingress/ingress.module";
import { AccountsModule } from "../accounts/accounts.module";

@Module({
  imports: [
    forwardRef(() => IngressModule),
    forwardRef(() => AccountsModule),
    TelegramModule,
  ],
  controllers: [WebhooksController],
  providers: [
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
  ],
})
export class WebhooksModule {}
