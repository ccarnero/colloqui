import { Module } from "@nestjs/common";
import { SystemVariablesController } from "./system-variables.controller";
import { SystemVariablesService } from "./system-variables.service";

@Module({
  controllers: [SystemVariablesController],
  providers: [SystemVariablesService],
  exports: [SystemVariablesService],
})
export class SystemVariablesModule {}
