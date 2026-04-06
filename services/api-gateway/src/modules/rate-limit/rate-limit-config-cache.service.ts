import { Injectable, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import type { RateLimitAlgorithm, RateLimitTenantConfig } from "@yoizen/shared";
import {
  RATE_LIMIT_CONFIG_POLL_INTERVAL_MS,
  RATE_LIMIT_CONFIG_FETCH_TIMEOUT_MS,
  RATE_LIMIT_DEFAULT_ALGORITHM,
} from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { gatewayConfig } from "../../config";

interface ITenantSummary {
  name: string;
  environment: string;
  configuration: Record<string, unknown>;
}

const VALID_ALGORITHMS = new Set<string>([
  "fixed_window",
  "sliding_window",
  "token_bucket",
]);

@Injectable()
export class RateLimitConfigCacheService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(RateLimitConfigCacheService.name);
  private readonly configs = new Map<string, RateLimitTenantConfig>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tenantServiceUrl: string;

  readonly defaultConfig: RateLimitTenantConfig;

  constructor() {
    this.tenantServiceUrl = gatewayConfig.services.tenant;

    const normalizedAlg = String(gatewayConfig.rateLimit.algorithm).replace(
      /-/g,
      "_",
    );
    const alg = VALID_ALGORITHMS.has(normalizedAlg)
      ? (normalizedAlg as RateLimitAlgorithm)
      : RATE_LIMIT_DEFAULT_ALGORITHM;
    this.defaultConfig = {
      algorithm: alg,
      limit: gatewayConfig.rateLimit.defaultLimit,
      windowMs: gatewayConfig.rateLimit.defaultWindowMs,
      capacity: gatewayConfig.rateLimit.defaultCapacity,
      refillRate: gatewayConfig.rateLimit.defaultRefillRate,
    };
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(
      () => this.refresh(),
      RATE_LIMIT_CONFIG_POLL_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get(tenantId: string): RateLimitTenantConfig {
    return this.configs.get(tenantId) ?? this.defaultConfig;
  }

  private async refresh(): Promise<void> {
    try {
      const res = await tracedFetch(`${this.tenantServiceUrl}/tenants`, {
        signal: AbortSignal.timeout(RATE_LIMIT_CONFIG_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          `Tenant service returned ${res.status} during rate-limit config refresh`,
        );
        return;
      }

      const tenants: ITenantSummary[] = await res.json();
      const next = new Map<string, RateLimitTenantConfig>();

      for (let i = 0; i < tenants.length; i++) {
        const t = tenants[i];
        const rl = t.configuration?.rateLimit as
          | Record<string, unknown>
          | undefined;
        if (!rl) continue;

        const parsed = this.parse(rl);
        if (parsed) next.set(t.name, parsed);
      }

      this.configs.clear();
      for (const [name, cfg] of next) {
        this.configs.set(name, cfg);
      }

      this.logger.debug(
        `Refreshed rate-limit configs: ${next.size} tenants with overrides`,
      );
    } catch (err) {
      this.logger.warn(`Failed to refresh rate-limit configs: ${err}`);
    }
  }

  private parse(raw: Record<string, unknown>): RateLimitTenantConfig | null {
    const algorithm =
      typeof raw.algorithm === "string" && VALID_ALGORITHMS.has(raw.algorithm)
        ? (raw.algorithm as RateLimitAlgorithm)
        : this.defaultConfig.algorithm;

    const limit =
      typeof raw.limit === "number" && raw.limit > 0
        ? raw.limit
        : this.defaultConfig.limit;

    const windowMs =
      typeof raw.windowMs === "number" && raw.windowMs > 0
        ? raw.windowMs
        : this.defaultConfig.windowMs;

    const capacity =
      typeof raw.capacity === "number" && raw.capacity > 0
        ? raw.capacity
        : this.defaultConfig.capacity;

    const refillRate =
      typeof raw.refillRate === "number" && raw.refillRate > 0
        ? raw.refillRate
        : this.defaultConfig.refillRate;

    return { algorithm, limit, windowMs, capacity, refillRate };
  }
}
