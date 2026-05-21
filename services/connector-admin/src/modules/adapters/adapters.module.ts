import { Module } from "@nestjs/common";
import { AdaptersController } from "./adapters.controller";
import { AdaptersRepository } from "./adapters.repository";
import { AdaptersService } from "./adapters.service";

@Module({
  controllers: [AdaptersController],
  providers: [AdaptersRepository, AdaptersService],
})
export class AdaptersModule {}
