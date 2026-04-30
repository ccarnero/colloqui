import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

@Injectable()
export class ChannelsProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.channel,
      "Channel service",
      ChannelsProxyService.name,
    );
  }
}
