import { Module } from "@nestjs/common";
import { StateMergerService } from "./state-merger.service";

@Module({
  providers: [StateMergerService],
  exports: [StateMergerService],
})
export class StateMergerModule {}
