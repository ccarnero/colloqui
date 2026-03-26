import { Module, forwardRef } from "@nestjs/common";
import { EgressController } from "./egress.controller";
import { EgressService } from "./egress.service";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { AccountsModule } from "../accounts/accounts.module";

@Module({
  imports: [forwardRef(() => WebhooksModule), forwardRef(() => AccountsModule)],
  controllers: [EgressController],
  providers: [EgressService],
  exports: [EgressService],
})
export class EgressModule {}
