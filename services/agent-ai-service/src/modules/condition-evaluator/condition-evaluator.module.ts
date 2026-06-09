import { Module } from "@nestjs/common";
import { ConditionEvaluatorService } from "./condition-evaluator.service";

@Module({
  providers: [ConditionEvaluatorService],
  exports: [ConditionEvaluatorService],
})
export class ConditionEvaluatorModule {}
