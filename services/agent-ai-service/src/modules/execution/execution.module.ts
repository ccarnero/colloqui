import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { ExecutionController } from "./execution.controller";

@Module({
  imports: [ChatModule],
  controllers: [ExecutionController],
})
export class ExecutionModule {}
