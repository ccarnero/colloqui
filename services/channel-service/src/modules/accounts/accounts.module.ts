import { Module } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";
import { AccountsRepository } from "./accounts.repository";
import { AccountsService } from "./accounts.service";
import { TelegramModule } from "../../providers/telegram/telegram.module";
@Module({
  imports: [TelegramModule],
  controllers: [AccountsController],
  providers: [AccountsRepository, AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
