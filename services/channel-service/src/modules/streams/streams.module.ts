import { Module } from "@nestjs/common";
import { StreamsController } from "./streams.controller";
import { StreamsService } from "./streams.service";

@Module({
  controllers: [StreamsController],
  providers: [StreamsService],
})
export class StreamsModule {}
