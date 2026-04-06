import { Module } from "@nestjs/common";
import { ExecutionsController } from "./executions.controller";
import { ExecutionsRepository } from "./executions.repository";
import { ExecutionsService } from "./executions.service";

@Module({
  controllers: [ExecutionsController],
  providers: [ExecutionsRepository, ExecutionsService],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
