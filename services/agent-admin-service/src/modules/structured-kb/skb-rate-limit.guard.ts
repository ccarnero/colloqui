import { Injectable, CanActivate, ExecutionContext, HttpException } from "@nestjs/common";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

@Injectable()
export class SKBRateLimitGuard implements CanActivate {
  private store = new Map<string, RateLimitEntry>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenantId = request.tenantId ?? "anonymous";
    const key = `skb:query:${tenantId}`;
    const now = Date.now();

    const entry = this.store.get(key);
    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }

    if (entry.count >= MAX_REQUESTS) {
      throw new HttpException(
        "Rate limit exceeded. Max 30 queries per minute per tenant.",
        429,
      );
    }

    entry.count++;
    return true;
  }
}
