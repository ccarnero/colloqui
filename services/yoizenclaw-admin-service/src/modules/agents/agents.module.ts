import { Module } from "@nestjs/common";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";
import { AgentsRepository } from "./agents.repository";
import { AdaptersModule } from "../adapters/adapters.module";

@Module({
  imports: [AdaptersModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentsRepository],
  exports: [AgentsService],
})
export class AgentsModule {}
