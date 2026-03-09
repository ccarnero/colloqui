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
} from '@nestjs/common';
import { CacheService } from './cache.service';

const TENANT_HEADER = 'x-yoizen-tenant';

function tenantKey(tenantId: string | undefined, key: string): string {
  return tenantId ? `${tenantId}:${key}` : key;
}

@Controller('cache')
export class CacheController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  async listKeys(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Query('pattern') pattern = '*',
    @Query('count') count = '100',
  ): Promise<string[]> {
    const scopedPattern = tenantId ? `${tenantId}:${pattern}` : pattern;
    return this.cache.scan(scopedPattern, parseInt(count, 10) || 100);
  }

  @Get(':key')
  async get(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('key') key: string,
  ): Promise<unknown> {
    return this.cache.get(tenantKey(tenantId, key));
  }

  @Put(':key')
  async set(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('key') key: string,
    @Body() body: { value: unknown; ttl?: number },
  ): Promise<{ ok: boolean }> {
    await this.cache.set(tenantKey(tenantId, key), body.value, body.ttl);
    return { ok: true };
  }

  @Delete(':key')
  async del(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('key') key: string,
  ): Promise<{ ok: boolean }> {
    await this.cache.del(tenantKey(tenantId, key));
    return { ok: true };
  }

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  async batchGet(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Body() body: { keys: string[] },
  ): Promise<Record<string, unknown>> {
    const scopedKeys = (body.keys ?? []).map((k) => tenantKey(tenantId, k));
    const map = await this.cache.batchGet(scopedKeys);
    return Object.fromEntries(map);
  }
}
