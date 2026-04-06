import { Controller, Get } from "@nestjs/common";
import { tracedFetch } from "@yoizen/observability";
import { proxyServiceConfig } from "../../config";

const TENANT_HEALTH_TIMEOUT_MS = 3_000;

@Controller()
export class HealthController {
  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    tenantService: "reachable" | "unreachable";
  }> {
    try {
      const res = await tracedFetch(
        `${proxyServiceConfig.tenantServiceUrl}/health`,
        { signal: AbortSignal.timeout(TENANT_HEALTH_TIMEOUT_MS) },
      );
      const ok = res.ok;
      return {
        status: ok ? "ok" : "degraded",
        tenantService: ok ? "reachable" : "unreachable",
      };
    } catch {
      return {
        status: "degraded",
        tenantService: "unreachable",
      };
    }
  }
}
