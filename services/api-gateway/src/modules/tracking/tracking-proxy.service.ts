import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

@Injectable()
export class TrackingProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.tracking,
      "Tracking service",
      TrackingProxyService.name
    );
  }
}
