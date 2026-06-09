import { Module } from "@nestjs/common";
import { DepthTrackerService } from "./depth-tracker.service";

@Module({
  providers: [DepthTrackerService],
  exports: [DepthTrackerService],
})
export class DepthTrackerModule {}
