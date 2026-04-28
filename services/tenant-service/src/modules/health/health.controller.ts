import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { HealthService } from "./health.service";
import type { ITenantHealthResponse } from "@yoizen/shared";

/**
 * Exposes `/health` for Knative liveness/readiness probes.
 *
 * Knative treats a 2xx as healthy and a 5xx as unhealthy: when the
 * aggregate status is `error` (Kubernetes / Postgres down OR the
 * JetStream provisioning consumer is in `stopped` state and the
 * in-process supervisor has exhausted its self-recovery), we return
 * HTTP 503 carrying the same JSON body so the dashboard still shows
 * which sub-system failed AND Knative recycles the pod.
 *
 * `degraded` status keeps the 200 contract — it signals the supervisor
 * is still actively trying to reattach (transient), so a pod restart
 * would just lose the in-flight reattach progress for no benefit.
 */
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  async check(): Promise<ITenantHealthResponse> {
    const body = await this.healthService.getStatus();
    if (body.status === "error") {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
