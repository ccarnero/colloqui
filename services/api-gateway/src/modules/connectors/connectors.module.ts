import { Module } from "@nestjs/common";
import { ConnectorsController } from "./connectors.controller";
import { ConnectorsProxyService } from "./connectors-proxy.service";

@Module({
  controllers: [ConnectorsController],
  providers: [ConnectorsProxyService],
})
export class ConnectorsModule {}
