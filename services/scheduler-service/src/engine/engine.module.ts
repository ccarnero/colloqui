import { Global, Module } from "@nestjs/common";
import { EngineService } from "./engine.service";
import { SchedulesModule } from "../modules/schedules/schedules.module";
import { ExecutionsModule } from "../modules/executions/executions.module";

@Global()
@Module({
  imports: [SchedulesModule, ExecutionsModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
