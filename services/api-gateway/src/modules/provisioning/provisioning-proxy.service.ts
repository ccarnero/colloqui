import { Injectable } from "@nestjs/common";
import { gatewayConfig } from "../../config";
import { TenantJsonProxyBase } from "../../utils/tenant-json-proxy.base";

/**
 * T07 of manual-loops/declarative-provisioning.md: tenant-scoped JSON proxy
 * to provisioning-service — manifests (validate/put/get), plan, apply, and
 * secrets CRUD. Dedicated proxy service per repo convention (mirrors
 * `ConnectorInvokeProxyService`/`TrackingProxyService`), reusing
 * `TenantJsonProxyBase`'s `proxy()`/`proxyWithStatus()` (which in turn reuses
 * `downstreamJsonProxyWithStatus` — the connector-invoke precedent named in
 * the SPEC) rather than inventing a parallel fetch helper.
 *
 * The broker's internal-only route (`POST /internal/secrets/resolve`) is
 * DELIBERATELY not reachable through this service — no method here targets
 * `/internal/*`. See `provisioning.controller.ts` for the enforced route
 * list and the regression test asserting the internal path is absent.
 */
@Injectable()
export class ProvisioningProxyService extends TenantJsonProxyBase {
  constructor() {
    super(
      gatewayConfig.services.provisioning,
      "Provisioning service",
      ProvisioningProxyService.name
    );
  }
}
