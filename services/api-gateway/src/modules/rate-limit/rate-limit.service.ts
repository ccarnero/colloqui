import { Injectable } from '@nestjs/common';
import type { RateLimitResult } from '@yoizen/shared';
import { RATE_LIMIT_KEY_PREFIX } from '@yoizen/shared';
import { gatewayConfig } from '../../config/gateway.config';
import { RateLimitConfigCacheService } from './rate-limit-config-cache.service';
import { FixedWindowStrategy } from './strategies/fixed-window.strategy';
import { SlidingWindowStrategy } from './strategies/sliding-window.strategy';
import { TokenBucketStrategy } from './strategies/token-bucket.strategy';
import type { RateLimitStrategy } from './strategies/rate-limit.strategy';

const STRATEGY_MAP = new Map<string, 'fw' | 'sw' | 'tb'>([
  ['fixed_window', 'fw'],
  ['sliding_window', 'sw'],
  ['token_bucket', 'tb'],
]);

@Injectable()
export class RateLimitService {
  private readonly environment: string;
  private readonly strategies: Map<string, RateLimitStrategy>;

  constructor(
    private readonly configCache: RateLimitConfigCacheService,
    fixedWindow: FixedWindowStrategy,
    slidingWindow: SlidingWindowStrategy,
    tokenBucket: TokenBucketStrategy,
  ) {
    this.environment = gatewayConfig.environment;
    this.strategies = new Map<string, RateLimitStrategy>([
      ['fw', fixedWindow],
      ['sw', slidingWindow],
      ['tb', tokenBucket],
    ]);
  }

  async consume(tenantId: string): Promise<RateLimitResult> {
    const config = this.configCache.get(tenantId);
    const strategyKey = STRATEGY_MAP.get(config.algorithm) ?? 'sw';
    const strategy = this.strategies.get(strategyKey)!;
    const key = `${RATE_LIMIT_KEY_PREFIX}${this.environment}:${tenantId}`;

    return strategy.consume(key, config);
  }
}
