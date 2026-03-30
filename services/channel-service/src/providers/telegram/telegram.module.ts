import { Module } from "@nestjs/common";
import { TelegramProvider } from "./telegram.provider";

@Module({
  providers: [TelegramProvider],
  exports: [TelegramProvider],
})
export class TelegramModule {}
