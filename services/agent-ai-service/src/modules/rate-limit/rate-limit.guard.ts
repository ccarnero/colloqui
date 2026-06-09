import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PinoLoggerService } from "@yoizen/observability";

export const RATE_LIMIT_KEY = "rateLimit";
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 5;

export interface RateLimitOptions {
  /** Sliding window duration in milliseconds. Default: 60_000 (1 minute) */
  windowMs?: number;
  /** Maximum requests allowed within the window. Default: 5 */
  maxRequests?: number;
}

interface RateLimitEntry {
  timestamps: number[];
}

/**
 * Decorator to configure rate limiting on a specific route handler.
 *
 * Usage:
 * ```
 * @RateLimit({ windowMs: 60_000, maxRequests: 5 })
 * @Post("stream")
 * async stream() { ... }
 * ```
 */
export const RateLimit = (options: RateLimitOptions = {}) =>
  SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new PinoLoggerService(RateLimitGuard.name);
  private readonly store = new Map<string, RateLimitEntry>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantId: string | undefined =
      request.tenantId ?? request.headers?.["x-yoizen-tenant"];
    const path: string = request.url ?? request.routeOptions?.url ?? "/";
    const key = `${tenantId ?? "anonymous"}:${path}`;

    const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    const maxRequests = options.maxRequests ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS;
    const now = Date.now();
    const windowStart = now - windowMs;

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // Prune timestamps outside the sliding window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    if (entry.timestamps.length >= maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + windowMs - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      this.logger.warn(
        `Rate limit exceeded for key '${key}': ${entry.timestamps.length}/${maxRequests} in ${windowMs}ms window`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many requests. Please retry later.",
          error: "Too Many Requests",
        },
        HttpStatus.TOO_MANY_REQUESTS,
        {
          cause: undefined,
          description: `retry_after=${retryAfterSeconds}`,
        },
      );
    }

    entry.timestamps.push(now);

    // Periodic cleanup of stale entries (every 100 requests check)
    if (Math.random() < 0.01) {
      this.cleanupStaleEntries(now, windowMs);
    }

    return true;
  }

  private cleanupStaleEntries(now: number, maxWindowMs: number): void {
    for (const [key, entry] of this.store) {
      entry.timestamps = entry.timestamps.filter((ts) => ts > now - maxWindowMs);
      if (entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }
}
