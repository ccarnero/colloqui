import { Module } from "@nestjs/common";
import { ConnectorInvokeController } from "./connector-invoke.controller";
import { ConnectorInvokeProxyService } from "./connector-invoke-proxy.service";

@Module({
  controllers: [ConnectorInvokeController],
  providers: [ConnectorInvokeProxyService],
})
export class ConnectorInvokeModule {}
