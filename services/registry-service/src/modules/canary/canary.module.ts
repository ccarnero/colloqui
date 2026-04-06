import { Module } from "@nestjs/common";
import { CanaryController } from "./canary.controller";
import { CanaryRepository } from "./canary.repository";
import { CanaryService } from "./canary.service";

@Module({
  controllers: [CanaryController],
  providers: [CanaryRepository, CanaryService],
})
export class CanaryModule {}
