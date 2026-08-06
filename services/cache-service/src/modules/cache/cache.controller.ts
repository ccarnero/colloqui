import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { BatchGetDto, ListCacheKeysQueryDto, SetCacheDto } from "./cache.dto";
import { CacheService } from "./cache.service";

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
    @Query() query: ListCacheKeysQueryDto
  ): Promise<string[]> {
    const scopedPattern = tenantId
      ? `${tenantId}:${query.pattern}`
      : query.pattern;
    return this.cache.scan(scopedPattern, query.count);
  }

  /**
   * Gets a single cached value by key.
   *
   * The value is serialized HERE instead of being handed to Fastify as-is:
   * Fastify sends a plain-string payload verbatim as `text/plain`, so a cached
   * string used to come back unquoted and unparseable by any JSON client
   * (`GET` of `"hello"` returned `hello` as text/plain) while objects, numbers
   * and `null` came back as `application/json`. Stringifying with an explicit
   * JSON content type makes every value type — including a miss (`null`) —
   * round-trip through `response.json()`.
   *
   * @param tenantId - Optional tenant prefix.
   * @param key - Logical key (combined with tenant when present).
   * @returns The JSON text of the value, or `"null"` when the key is missing.
   */
  @Get(":key")
  @Header("Content-Type", "application/json; charset=utf-8")
  async get(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("key") key: string
  ): Promise<string> {
    const value = await this.cache.get(tenantKey(tenantId, key));
    return JSON.stringify(value ?? null);
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
    @Body() body: SetCacheDto
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
    @Param("key") key: string
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
    @Body() body: BatchGetDto
  ): Promise<Record<string, unknown>> {
    const scopedKeys = body.keys.map((k) => tenantKey(tenantId, k));
    const map = await this.cache.batchGet(scopedKeys);
    return Object.fromEntries(map);
  }
}
