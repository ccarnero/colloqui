import { Controller, Get, Inject } from '@nestjs/common';
import { tracedFetch } from '@yoizen/observability';
import type { NatsConnection } from 'nats';
import type Redis from 'ioredis';
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
  ['auth-service', process.env.AUTH_SERVICE_URL ?? 'http://auth-service.platform-services.svc.cluster.local'],
  ['cache-service', process.env.CACHE_SERVICE_URL ?? 'http://cache-service.platform-services.svc.cluster.local'],
  ['webhook-service', process.env.WEBHOOK_SERVICE_URL ?? 'http://webhook-service.platform-services.svc.cluster.local'],
  ['audit-service', process.env.AUDIT_SERVICE_URL ?? 'http://audit-service.platform-services.svc.cluster.local'],
  ['event-processor', process.env.EVENT_PROCESSOR_URL ?? 'http://event-processor.platform-services.svc.cluster.local'],
  ['metrics-service', process.env.METRICS_SERVICE_URL ?? 'http://metrics-service.platform-services.svc.cluster.local'],
  ['tenant-service', process.env.TENANT_SERVICE_URL ?? 'http://tenant-service.platform-services.svc.cluster.local'],
  ['registry-service', process.env.REGISTRY_SERVICE_URL ?? 'http://registry-service.platform-services.svc.cluster.local'],
  ['workflow-service', process.env.WORKFLOW_SERVICE_URL ?? 'http://workflow-api.platform-services.svc.cluster.local'],
  ['proxy-service', process.env.PROXY_SERVICE_URL ?? 'http://proxy-service.platform-services.svc.cluster.local'],
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
