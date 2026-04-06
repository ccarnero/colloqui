import { Global, Module } from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service";
import { RateLimitConfigCacheService } from "./rate-limit-config-cache.service";
import { FixedWindowStrategy } from "./strategies/fixed-window.strategy";
import { SlidingWindowStrategy } from "./strategies/sliding-window.strategy";
import { TokenBucketStrategy } from "./strategies/token-bucket.strategy";

@Global()
@Module({
  providers: [
    RateLimitConfigCacheService,
    FixedWindowStrategy,
    SlidingWindowStrategy,
    TokenBucketStrategy,
    RateLimitService,
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}
