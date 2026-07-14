import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

/**
 * T03 of manual-loops/connector-invoke-api.md: proxies to connector-runtime's
 * HTTP invoke facade (T02, `services/connector-runtime/src/http-main.ts`),
 * a distinct downstream from `ConnectorsProxyService` (connector-admin — CRUD
 * only). Explicit dedicated proxy service per repo convention (mirrors
 * `TrackingProxyService`), never folded into `ConnectorsProxyService` since
 * the base URL and failure surface differ.
 */
@Injectable()
export class ConnectorInvokeProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.connectorRuntimeHttp,
      "Connector invoke facade",
      ConnectorInvokeProxyService.name
    );
  }
}
