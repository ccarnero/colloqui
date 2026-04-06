import type { RateLimitResult, RateLimitTenantConfig } from "@yoizen/shared";

export interface IRateLimitStrategy {
  consume(key: string, config: RateLimitTenantConfig): Promise<RateLimitResult>;
}
