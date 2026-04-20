import { Module } from "@nestjs/common";
import { ExecutionProjectorService } from "./execution-projector.service";
import { ExecutionsProjectionRepository } from "./executions.repository";

@Module({
  providers: [ExecutionProjectorService, ExecutionsProjectionRepository],
})
export class ExecutionsProjectorModule {}
