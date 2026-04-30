import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

@Injectable()
export class WorkflowProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.workflow,
      "Workflow service",
      WorkflowProxyService.name,
    );
  }
}
