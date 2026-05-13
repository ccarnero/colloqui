import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

@Injectable()
export class ConnectorsProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.connectorAdmin,
      "Connector admin",
      ConnectorsProxyService.name,
    );
  }
}
