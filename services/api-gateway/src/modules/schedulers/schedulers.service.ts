import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

@Injectable()
export class SchedulerProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.scheduler,
      "Scheduler service",
      SchedulerProxyService.name,
    );
  }
}
