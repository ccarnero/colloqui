import type { RateLimitResult, RateLimitTenantConfig } from '@yoizen/shared';

export interface RateLimitStrategy {
  consume(key: string, config: RateLimitTenantConfig): Promise<RateLimitResult>;
}
