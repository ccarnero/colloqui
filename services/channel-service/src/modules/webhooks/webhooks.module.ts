import { forwardRef, Module } from "@nestjs/common";
import { ChannelRouter } from "../../providers/channel-router";
import { E2eTestsModule } from "../../providers/e2e-tests/e2e-tests.module";
import { HttpModule } from "../../providers/http/http.module";
import { TelegramModule } from "../../providers/telegram/telegram.module";
import { AccountsModule } from "../accounts/accounts.module";
import { IngressModule } from "../ingress/ingress.module";
import { WebhookIngressService } from "./webhook-ingress.service";
import { WebhookIngressConsumerService } from "./webhook-ingress-consumer.service";

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
    ChannelRouter,
  ],
  exports: [ChannelRouter, TelegramModule, HttpModule, E2eTestsModule],
})
export class WebhooksModule {}
