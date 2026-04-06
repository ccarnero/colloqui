import { Module } from "@nestjs/common";
import { RegistryController } from "./registry.controller";
import { RegistryProxyService } from "./registry-proxy.service";

@Module({
  controllers: [RegistryController],
  providers: [RegistryProxyService],
})
export class RegistryModule {}
