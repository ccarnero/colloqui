import { Module } from "@nestjs/common";
import { SchedulesController } from "./schedules.controller";
import { SchedulesRepository } from "./schedules.repository";
import { SchedulesService } from "./schedules.service";

@Module({
  controllers: [SchedulesController],
  providers: [SchedulesRepository, SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
