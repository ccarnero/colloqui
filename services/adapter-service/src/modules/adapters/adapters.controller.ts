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
import { TENANT_HEADER } from "@yoizen/shared";
import { AdaptersService } from "./adapters.service";
import {
  CreateAdapterDto,
  UpdateAdapterDto,
  CreateEndpointDto,
} from "./adapters.dto";

@Controller("adapters")
export class AdaptersController {
  constructor(private readonly adaptersService: AdaptersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateAdapterDto,
  ) {
    return this.adaptersService.create(tenantId, dto);
  }

  @Get()
  async list(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query("context") context?: string,
  ) {
    return this.adaptersService.list(tenantId, context);
  }

  @Get(":id")
  async get(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ) {
    return this.adaptersService.get(tenantId, id);
  }

  @Patch(":id")
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAdapterDto,
  ) {
    return this.adaptersService.update(tenantId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ) {
    return this.adaptersService.remove(tenantId, id);
  }

  @Post(":id/endpoints")
  @HttpCode(HttpStatus.CREATED)
  async addEndpoint(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
    @Body() dto: CreateEndpointDto,
  ) {
    return this.adaptersService.addEndpoint(tenantId, id, dto);
  }

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
