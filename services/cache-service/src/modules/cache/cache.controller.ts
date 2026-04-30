import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { CacheService } from "./cache.service";
import { BatchGetDto, ListCacheKeysQueryDto, SetCacheDto } from "./cache.dto";

function tenantKey(tenantId: string | undefined, key: string): string {
  return tenantId ? `${tenantId}:${key}` : key;
}

@Controller("cache")
export class CacheController {
  constructor(private readonly cache: CacheService) {}

  /**
   * Lists cache keys under an optional tenant prefix.
   * @param tenantId - When set, keys are scoped as `{tenantId}:{pattern}`.
   * @param query - Pattern and SCAN count.
   */
  @Get()
  async listKeys(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query() query: ListCacheKeysQueryDto,
  ): Promise<string[]> {
    const scopedPattern = tenantId
      ? `${tenantId}:${query.pattern}`
      : query.pattern;
    return this.cache.scan(scopedPattern, query.count);
  }

  /**
   * Gets a single cached value by key.
   * @param tenantId - Optional tenant prefix.
   * @param key - Logical key (combined with tenant when present).
   */
  @Get(":key")
  async get(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("key") key: string,
  ): Promise<unknown> {
    return this.cache.get(tenantKey(tenantId, key));
  }

  /**
   * Sets a value with optional TTL.
   * @param tenantId - Optional tenant prefix.
   * @param key - Logical key.
   * @param body - Value and optional TTL seconds.
   */
  @Put(":key")
  async set(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("key") key: string,
    @Body() body: SetCacheDto,
  ): Promise<{ ok: boolean }> {
    await this.cache.set(tenantKey(tenantId, key), body.value, body.ttl);
    return { ok: true };
  }

  /**
   * Deletes a key from L2 and L1.
   * @param tenantId - Optional tenant prefix.
   * @param key - Logical key.
   */
  @Delete(":key")
  async del(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("key") key: string,
  ): Promise<{ ok: boolean }> {
    await this.cache.del(tenantKey(tenantId, key));
    return { ok: true };
  }

  /**
   * Batch GET for multiple logical keys (one Redis pipeline).
   * @param tenantId - Optional tenant prefix applied to each key.
   * @param body - List of logical keys.
   */
  @Post("batch")
  @HttpCode(HttpStatus.OK)
  async batchGet(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Body() body: BatchGetDto,
  ): Promise<Record<string, unknown>> {
    const scopedKeys = body.keys.map((k) => tenantKey(tenantId, k));
    const map = await this.cache.batchGet(scopedKeys);
    return Object.fromEntries(map);
  }
}
