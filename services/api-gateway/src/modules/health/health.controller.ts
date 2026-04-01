import { Controller, Get, Inject } from '@nestjs/common';
import { tracedFetch } from '@yoizen/observability';
import type { NatsConnection } from 'nats';
import type Redis from 'ioredis';
import { gatewayConfig } from '../../config/gateway.config';
import { NATS_CONNECTION } from '../../providers/nats.provider';
import { REDIS_CLIENT } from '../../providers/redis.provider';
import { Public } from '../../decorators/public.decorator';
import { SkipTenant } from '../../decorators/skip-tenant.decorator';

interface ServiceHealth {
  status: string;
  [key: string]: unknown;
}

interface HealthResponse {
  status: string;
  nats: string;
  redis: string;
  services: Record<string, ServiceHealth | 'unreachable'>;
}

const SERVICE_URLS = new Map<string, string>([
  ['auth-service', gatewayConfig.services.auth],
  ['cache-service', gatewayConfig.services.cache],
  ['webhook-service', gatewayConfig.services.webhook],
  ['audit-service', gatewayConfig.services.audit],
  ['event-processor', gatewayConfig.services.eventProcessor],
  ['metrics-service', gatewayConfig.services.metrics],
  ['tenant-service', gatewayConfig.services.tenant],
  ['registry-service', gatewayConfig.services.registry],
  ['workflow-service', gatewayConfig.services.workflow],
  ['proxy-service', gatewayConfig.services.proxy],
  ['adapter-service', gatewayConfig.services.adapter],
]);

const SERVICE_TIMEOUT_MS = 3_000;

@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @SkipTenant()
  @Get('health')
  async check(): Promise<HealthResponse> {
    const [natsOk, redisOk, services] = await Promise.all([
      this.checkNats(),
      this.checkRedis(),
      this.checkServices(),
    ]);

    const allServicesOk = [...services.values()].every(
      (s) => typeof s === 'object' && s.status === 'ok',
    );
    const status = natsOk && redisOk && allServicesOk ? 'ok' : 'degraded';

    return {
      status,
      nats: natsOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
      services: Object.fromEntries(services),
    };
  }

  private checkNats(): boolean {
    return !this.nc.isClosed();
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async checkServices(): Promise<Map<string, ServiceHealth | 'unreachable'>> {
    const results = new Map<string, ServiceHealth | 'unreachable'>();
    const entries = [...SERVICE_URLS.entries()];

    const checks = entries.map(async ([name, baseUrl]) => {
      try {
        const res = await tracedFetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
        });
        if (res.ok) {
          results.set(name, (await res.json()) as ServiceHealth);
        } else {
          results.set(name, 'unreachable');
        }
      } catch {
        results.set(name, 'unreachable');
      }
    });

    await Promise.all(checks);
    return results;
  }
}
