import type { AdapterCache } from "@yoizen/shared";

export interface ICachedHttpResponseEntry {
  readonly status: number;
  readonly bodyBase64: string;
  readonly headers: Record<string, string>;
  readonly storedAtMs: number;
}

export interface IHttpResponseCache {
  get(key: string): Promise<ICachedHttpResponseEntry | null>;
  setex(
    key: string,
    ttlSeconds: number,
    entry: ICachedHttpResponseEntry,
  ): Promise<void>;
}

export function createHttpResponseCache(
  cache: AdapterCache,
): IHttpResponseCache {
  return {
    async get(key: string): Promise<ICachedHttpResponseEntry | null> {
      const raw = await cache.get(key);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as ICachedHttpResponseEntry;
      } catch {
        return null;
      }
    },

    async setex(
      key: string,
      ttlSeconds: number,
      entry: ICachedHttpResponseEntry,
    ): Promise<void> {
      await cache.setex(key, ttlSeconds, JSON.stringify(entry));
    },
  };
}
