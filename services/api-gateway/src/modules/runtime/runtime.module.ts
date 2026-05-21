import { Module } from "@nestjs/common";
import { RuntimeController } from "./runtime.controller";
import { RuntimeProxyService } from "./runtime-proxy.service";

@Module({
  controllers: [RuntimeController],
  providers: [RuntimeProxyService],
})
export class RuntimeModule {}
