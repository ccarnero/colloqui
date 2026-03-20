import { Module } from "@nestjs/common";
import { AdaptersController } from "./adapters.controller";
import { AdaptersProxyService } from "./adapters-proxy.service";

@Module({
  controllers: [AdaptersController],
  providers: [AdaptersProxyService],
})
export class AdaptersModule {}
