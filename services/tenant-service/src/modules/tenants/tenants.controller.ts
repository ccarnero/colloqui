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
  type ICreateTenantAccepted,
  type ITenantDetail,
  type ITenantSummary,
} from "./tenants.service";
import { CreateTenantDto, UpdateTenantDto } from "./tenant.dto";
import { isPlatformTenantRowIdParam } from "@yoizen/shared";

/** Kubernetes namespace + PostgreSQL provisioning per tenant. */
@Controller("tenants")
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * Creates a platform tenant record and enqueues async provisioning.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Body() dto: CreateTenantDto,
  ): Promise<ICreateTenantAccepted> {
    return this.tenantsService.createTenant(dto.name, dto.tier, dto.configuration);
  }

  @Get()
  async list(): Promise<ITenantSummary[]> {
    return this.tenantsService.listTenants();
  }

  /**
   * Resolves a tenant by UUID (async status polling) or by name (registry).
   */
  @Get(":nameOrId")
  async getOne(
    @Param("nameOrId") nameOrId: string,
  ): Promise<ITenantDetail> {
    if (isPlatformTenantRowIdParam(nameOrId)) {
      return this.tenantsService.getTenantById(nameOrId);
    }
    return this.tenantsService.getTenant(nameOrId);
  }

  @Patch(":name")
  async update(
    @Param("name") name: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<ITenantDetail> {
    return this.tenantsService.updateTenant(name, dto.configuration);
  }

  @Delete(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("name") name: string): Promise<void> {
    return this.tenantsService.deleteTenant(name);
  }
}
