import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AgentsModule } from "../agents/agents.module";

@Module({
  imports: [AgentsModule],
  controllers: [AdminController],
})
export class AdminModule {}
