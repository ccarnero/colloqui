import { Module } from "@nestjs/common";
import { RuntimeController } from "./runtime.controller";
import { RuntimeHealthController } from "./runtime-health.controller";
import { RuntimeProxyService } from "./runtime-proxy.service";

@Module({
  controllers: [RuntimeController, RuntimeHealthController],
  providers: [RuntimeProxyService],
})
export class RuntimeModule {}
