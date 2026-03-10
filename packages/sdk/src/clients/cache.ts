import type { HttpTransport } from '../transport';
import type { CacheSetOptions } from '../types';

export class CacheClient {
  constructor(private readonly transport: HttpTransport) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      return await this.transport.get<T>(`/cache/${encodeURIComponent(key)}`);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
        return null;
      }
      throw err;
    }
  }

  async set(key: string, value: unknown, opts?: CacheSetOptions): Promise<void> {
    await this.transport.put(`/cache/${encodeURIComponent(key)}`, {
      value,
      ttl: opts?.ttl,
    });
  }

  async delete(key: string): Promise<void> {
    await this.transport.delete(`/cache/${encodeURIComponent(key)}`);
  }

  async scan(pattern?: string, count?: number): Promise<string[]> {
    return this.transport.get<string[]>('/cache', { pattern, count });
  }

  async batchGet<T = unknown>(keys: string[]): Promise<Record<string, T>> {
    return this.transport.post<Record<string, T>>('/cache/batch', { keys });
  }
}
