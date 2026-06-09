import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { Agent } from "./agent.model";

interface CacheEntry {
  agent: Agent;
  tenantId: string;
  agentId: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SIZE = 500;

@Injectable()
export class AgentCacheService {
  private readonly logger = new PinoLoggerService(AgentCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor() {
    this.ttlMs = DEFAULT_TTL_MS;
    this.maxSize = DEFAULT_MAX_SIZE;
  }

  get(tenantId: string, agentId: string): Agent | null {
    const key = this.buildKey(tenantId, agentId);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.agent;
  }

  set(tenantId: string, agent: Agent): void {
    this.evictIfNeeded();
    const key = this.buildKey(tenantId, agent.id);
    this.cache.set(key, {
      agent,
      tenantId,
      agentId: agent.id,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(tenantId: string, agentId: string): void {
    const key = this.buildKey(tenantId, agentId);
    this.cache.delete(key);
    this.logger.debug(`Cache invalidated: ${key}`);
  }

  invalidateAll(tenantId: string): void {
    const prefix = `${tenantId}:`;
    for (const [key] of this.cache) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
    this.logger.debug(`All cache invalidated for tenant '${tenantId}'`);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private buildKey(tenantId: string, agentId: string): string {
    return `${tenantId}:${agentId}`;
  }

  private evictIfNeeded(): void {
    if (this.cache.size < this.maxSize) return;
    const oldest = this.cache.keys().next().value;
    if (oldest) {
      this.cache.delete(oldest);
    }
  }
}
