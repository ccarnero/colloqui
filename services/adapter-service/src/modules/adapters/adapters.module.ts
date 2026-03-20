import { Module } from "@nestjs/common";
import { AdaptersController } from "./adapters.controller";
import { AdaptersService } from "./adapters.service";

@Module({
  controllers: [AdaptersController],
  providers: [AdaptersService],
})
export class AdaptersModule {}
