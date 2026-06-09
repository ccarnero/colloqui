import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { NatsConnection } from "nats";
import type Redis from "ioredis";
import { checkNats, checkRedis } from "@yoizen/database";
import type {
  IApiGatewayHealthResponse,
  IGatewayDownstreamHealth,
  IGatewayDownstreamHealthBody,
} from "@yoizen/shared";
import { gatewayConfig } from "../../config";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { REDIS_CLIENT } from "../../providers/redis.provider";

const SERVICE_URLS = new Map<string, string>([
  ["auth-service", gatewayConfig.services.auth],
  ["cache-service", gatewayConfig.services.cache],
  ["audit-service", gatewayConfig.services.audit],
  ["tenant-service", gatewayConfig.services.tenant],
  ["registry-service", gatewayConfig.services.registry],
  ["workflow-service", gatewayConfig.services.workflow],
  ["proxy-service", gatewayConfig.services.proxy],
  ["connector-admin", gatewayConfig.services.connectorAdmin],
  ["channel-service", gatewayConfig.services.channel],
  ["agent-admin-service", gatewayConfig.services.admin],
  ["ai-agent-gateway", gatewayConfig.services.aiAgentGateway],
]);

const SERVICE_TIMEOUT_MS = 3_000;

/**
 * Aggregates NATS, Redis, and downstream service health for GET /health.
 */
@Injectable()
export class GatewayHealthService {
  private readonly logger = new PinoLoggerService(GatewayHealthService.name);

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<IApiGatewayHealthResponse> {
    const [natsOk, redisOk, services] = await Promise.all([
      Promise.resolve(checkNats(this.nc)),
      checkRedis(this.redis),
      this.checkServices(),
    ]);

    const allServicesOk = [...services.values()].every(
      (s) => typeof s === "object" && s.status === "ok",
    );
    const status = natsOk && redisOk && allServicesOk ? "ok" : "degraded";

    return {
      status,
      nats: natsOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
      services: Object.fromEntries(services),
    };
  }

  private async checkServices(): Promise<
    Map<string, IGatewayDownstreamHealth>
  > {
    const results = new Map<string, IGatewayDownstreamHealth>();
    const entries = [...SERVICE_URLS.entries()];

    const checks = entries.map(async ([name, baseUrl]) => {
      try {
        const res = await tracedFetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
        });
        if (res.ok) {
          results.set(name, (await res.json()) as IGatewayDownstreamHealthBody);
        } else {
          results.set(name, "unreachable");
        }
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        this.logger.debug(`Downstream health check failed for ${name}: ${detail}`);
        results.set(name, "unreachable");
      }
    });

    await Promise.all(checks);
    return results;
  }
}
