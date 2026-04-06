import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  TenantsService,
  type ITenantDetail,
  type ITenantSummary,
} from "./tenants.service";
import { CreateTenantDto, UpdateTenantDto } from "./tenant.dto";

/** Kubernetes namespace + PostgreSQL provisioning per tenant. */
@Controller("tenants")
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * Creates a tenant namespace and database resources.
   *
   * @param dto  Tenant name and optional configuration payload.
   * @returns Created tenant detail.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTenantDto): Promise<ITenantDetail> {
    return this.tenantsService.createTenant(dto.name, dto.configuration);
  }

  /**
   * Lists all tenants visible to this service instance.
   *
   * @returns Tenant id/name summaries.
   */
  @Get()
  async list(): Promise<ITenantSummary[]> {
    return this.tenantsService.listTenants();
  }

  /**
   * Fetches one tenant by unique name.
   *
   * @param name  Tenant identifier.
   * @returns Full tenant detail.
   */
  @Get(":name")
  async get(@Param("name") name: string): Promise<ITenantDetail> {
    return this.tenantsService.getTenant(name);
  }

  /**
   * Updates tenant configuration in place.
   *
   * @param name  Tenant identifier.
   * @param dto   Partial configuration patch.
   * @returns Updated tenant detail.
   */
  @Patch(":name")
  async update(
    @Param("name") name: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<ITenantDetail> {
    return this.tenantsService.updateTenant(name, dto.configuration);
  }

  /**
   * Deletes a tenant and tears down associated resources.
   *
   * @param name  Tenant identifier.
   */
  @Delete(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("name") name: string): Promise<void> {
    return this.tenantsService.deleteTenant(name);
  }
}
