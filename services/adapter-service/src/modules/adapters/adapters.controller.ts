import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { clampListLimit, clampListOffset, TENANT_HEADER } from "@yoizen/shared";
import { AdaptersService } from "./adapters.service";
import {
  CreateAdapterDto,
  UpdateAdapterDto,
  CreateEndpointDto,
  ListAdaptersQueryDto,
} from "./adapters.dto";

/** Tenant-scoped CRUD for HTTP adapters and their endpoints. */
@Controller("adapters")
export class AdaptersController {
  constructor(private readonly adaptersService: AdaptersService) {}

  /**
   * Creates an adapter (and optional inline endpoints).
   * @param tenantId - Tenant from `x-yoizen-tenant`.
   * @param dto - Adapter definition and optional endpoints.
   * @returns Persisted adapter with nested endpoints.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateAdapterDto,
  ) {
    return this.adaptersService.create(tenantId, dto);
  }

  /**
   * Lists adapters for the tenant, optionally filtered by `context`.
   * @returns Paginated adapter rows with nested endpoints.
   */
  @Get()
  async list(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: ListAdaptersQueryDto,
  ) {
    const limit = clampListLimit(query.limit);
    const offset = clampListOffset(query.offset);
    return this.adaptersService.list(tenantId, query.context, limit, offset);
  }

  /**
   * Returns one adapter by id with nested endpoints.
   * @param tenantId - Tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   */
  @Get(":id")
  async get(@Headers(TENANT_HEADER) tenantId: string, @Param("id") id: string) {
    return this.adaptersService.get(tenantId, id);
  }

  /**
   * Partially updates adapter fields.
   * @param tenantId - Tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   * @param dto - Fields to merge.
   */
  @Patch(":id")
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAdapterDto,
  ) {
    return this.adaptersService.update(tenantId, id, dto);
  }

  /**
   * Deletes an adapter and its endpoints (cascade).
   * @param tenantId - Tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ) {
    return this.adaptersService.remove(tenantId, id);
  }

  /**
   * Adds an endpoint row to an existing adapter.
   * @param tenantId - Tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   * @param dto - Endpoint label, method, path.
   */
  @Post(":id/endpoints")
  @HttpCode(HttpStatus.CREATED)
  async addEndpoint(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
    @Body() dto: CreateEndpointDto,
  ) {
    return this.adaptersService.addEndpoint(tenantId, id, dto);
  }

  /**
   * Removes one endpoint from an adapter.
   * @param tenantId - Tenant from `x-yoizen-tenant`.
   * @param id - Adapter primary key.
   * @param epId - Endpoint primary key.
   */
  @Delete(":id/endpoints/:epId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeEndpoint(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
    @Param("epId") epId: string,
  ) {
    return this.adaptersService.removeEndpoint(tenantId, id, epId);
  }
}
