export type RateLimitAlgorithm =
  | 'fixed_window'
  | 'sliding_window'
  | 'token_bucket';

export interface RateLimitTenantConfig {
  algorithm: RateLimitAlgorithm;
  /** Max requests per window (fixed_window / sliding_window). */
  limit: number;
  /** Window duration in milliseconds (fixed_window / sliding_window). */
  windowMs: number;
  /** Bucket capacity / burst size (token_bucket). */
  capacity: number;
  /** Tokens added per second (token_bucket). */
  refillRate: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}
