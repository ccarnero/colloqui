import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

@Injectable()
export class AdaptersProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.adapter,
      "Adapter service",
      AdaptersProxyService.name,
    );
  }
}
