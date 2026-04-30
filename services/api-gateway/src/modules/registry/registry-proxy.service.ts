import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

@Injectable()
export class RegistryProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.registry,
      "Registry service",
      RegistryProxyService.name,
    );
  }
}
