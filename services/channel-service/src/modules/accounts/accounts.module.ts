import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { channelServiceConfig } from "../../config";
import { TelegramModule } from "../../providers/telegram/telegram.module";
import { AccountsController } from "./accounts.controller";
import { AccountsMongoRepository } from "./accounts.mongo.repository";
import { AccountsPostgresRepository } from "./accounts.postgres.repository";
import {
  ACCOUNTS_REPOSITORY,
  type IAccountsRepository,
} from "./accounts.repository.interface";
import { AccountsService } from "./accounts.service";

@Module({
  imports: [TelegramModule],
  controllers: [AccountsController],
  providers: [
    createRepositoryProvider<IAccountsRepository>({
      token: ACCOUNTS_REPOSITORY,
      engine: channelServiceConfig.dbEngine,
      postgresClass: AccountsPostgresRepository,
      mongoClass: AccountsMongoRepository,
    }),
    AccountsService,
  ],
  exports: [AccountsService],
})
export class AccountsModule {}
