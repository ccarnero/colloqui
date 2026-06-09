import { Module } from "@nestjs/common";
import { RuntimeController } from "./runtime.controller";
import { RuntimeService } from "./runtime.service";

/**
 * Runtime module for connection status and system metrics.
 */
@Module({
  controllers: [RuntimeController],
  providers: [RuntimeService],
  exports: [RuntimeService],
})
export class RuntimeModule {}
