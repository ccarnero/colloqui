import { Module } from "@nestjs/common";
import { WorkflowsModule } from "../workflows/workflows.module";
import { TriggerConsumerService } from "./trigger-consumer.service";

@Module({
  imports: [WorkflowsModule],
  providers: [TriggerConsumerService],
})
export class TriggersModule {}
