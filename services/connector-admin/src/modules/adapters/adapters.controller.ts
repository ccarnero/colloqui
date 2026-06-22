import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { clampListLimit, clampListOffset } from "@yoizen/shared";
import {
  CreateAdapterDto,
  CreateEndpointDto,
  ListAdaptersQueryDto,
  UpdateAdapterDto,
  UpdateEndpointDto,
} from "./adapters.dto";
import { AdaptersService } from "./adapters.service";

@Controller("connectors")
@UseGuards(TenantGuard)
export class AdaptersController {
  constructor(private readonly adaptersService: AdaptersService) {}

  /**
   * @param tenantId - Validated tenant from `x-yoizen-tenant`.
   * @param dto - Adapter definition and optional endpoints.
   * @returns Persisted adapter with nested endpoints.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@TenantId() tenantId: string, @Body() dto: CreateAdapterDto) {
    return this.adaptersService.create(tenantId, dto);
  }

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query() query: ListAdaptersQueryDto
  ) {
    const limit = clampListLimit(query.limit);
    const offset = clampListOffset(query.offset);
    return this.adaptersService.list(
      tenantId,
      query.context,
      limit,
      offset,
      query.tag,
      query.name
    );
  }

  /**
   * Per-adapter call usage stats (counts, error rates, avg latency)
   * over a rolling window. Declared before `@Get(':id')` so Nest does
   * not match `usage` as an adapter id.
   *
   * @param tenantId  - Validated tenant from `x-yoizen-tenant`.
   * @param window    - Rolling window in days (query param, default 7).
   */
  @Get("usage")
  async usage(@TenantId() tenantId: string, @Query("window") window?: string) {
    const windowDays = window ? Math.max(1, parseInt(window, 10) || 7) : 7;
    const topByCallCount = await this.adaptersService.getUsage(
      tenantId,
      windowDays
    );
    return { windowDays, topByCallCount };
  }

  /**
   * @param tenantId - Validated tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   */
  @Get(":id")
  async get(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.adaptersService.get(tenantId, id);
  }

  /**
   * @param tenantId - Validated tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   * @param dto - Fields to merge.
   */
  @Patch(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAdapterDto
  ) {
    return this.adaptersService.update(tenantId, id, dto);
  }

  /**
   * @param tenantId - Validated tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.adaptersService.remove(tenantId, id);
  }

  /**
   * @param tenantId - Validated tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   * @param dto - Endpoint label, method, path.
   */
  @Post(":id/endpoints")
  @HttpCode(HttpStatus.CREATED)
  async addEndpoint(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: CreateEndpointDto
  ) {
    return this.adaptersService.addEndpoint(tenantId, id, dto);
  }

  /**
   * @param tenantId - Validated tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   * @param epId - Endpoint primary key.
   */
  @Delete(":id/endpoints/:epId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeEndpoint(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Param("epId") epId: string
  ) {
    return this.adaptersService.removeEndpoint(tenantId, id, epId);
  }

  /**
   * @param tenantId - Validated tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   * @param epId - Endpoint primary key.
   * @param dto - Partial endpoint fields to merge.
   */
  @Patch(":id/endpoints/:epId")
  async updateEndpoint(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Param("epId") epId: string,
    @Body() dto: UpdateEndpointDto
  ) {
    return this.adaptersService.updateEndpoint(tenantId, id, epId, dto);
  }
}
