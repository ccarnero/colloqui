import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpException,
  HttpStatus,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  TenantsService,
  type ICreateTenantAccepted,
  type ITenantDetail,
  type ITenantSummary,
} from "./tenants.service";
import { CreateTenantDto, UpdateTenantDto } from "./tenant.dto";
import {
  isPlatformTenantRowIdParam,
  isProvisioningStatus,
  ProvisioningStatus,
  type ProvisioningStatusValue,
} from "@yoizen/shared";

/**
 * Default Retry-After (seconds) advertised when a DELETE arrives while
 * the tenant is still `provisioning`. Tuned to the worst-case shared
 * tier provisioning runtime (≈ 0.4 s) plus a safety margin; dedicated
 * tier callers will see multiple 409s before the row settles, which is
 * the intended back-pressure.
 */
const DELETE_RETRY_AFTER_SECONDS = 10;

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

  /**
   * Lists tenants. Optional `?status=` query filters by `provisioningStatus`
   * — accepts any value defined by the shared {@link ProvisioningStatus}
   * enum (`pending` / `provisioning` / `ready` / `failed`). Validation uses
   * the O(1) `isProvisioningStatus` set guard from `@yoizen/shared`; an
   * unknown value yields `400 Bad Request` rather than silently returning
   * the unfiltered set.
   *
     * Default behavior (no query param) is unchanged: every row is returned,
     * preserving compatibility with admin tooling like `agent-admin-service`.
   */
  @Get()
  async list(
    @Query("status") status?: string,
  ): Promise<ITenantSummary[]> {
    let parsed: ProvisioningStatusValue | undefined;
    if (status !== undefined && status !== "") {
      if (!isProvisioningStatus(status)) {
        throw new BadRequestException(
          `Invalid status='${status}'. Must be one of: ${Object.values(ProvisioningStatus).join(", ")}.`,
        );
      }
      parsed = status;
    }
    return this.tenantsService.listTenants(
      parsed === undefined ? undefined : { status: parsed },
    );
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

  /**
   * Deletes a tenant. When the tenant is currently `provisioning` the
   * service raises HTTP 409 — we intercept it here to also set the
   * `Retry-After` header so HTTP clients (including our own e2e
   * cleanup) automatically wait the recommended interval before
   * retrying. On success returns 204 with no body.
   */
  @Delete(":name")
  async remove(
    @Param("name") name: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    try {
      await this.tenantsService.deleteTenant(name);
      reply.code(HttpStatus.NO_CONTENT);
      return;
    } catch (err) {
      if (
        err instanceof HttpException &&
        err.getStatus() === HttpStatus.CONFLICT
      ) {
        reply.header("Retry-After", String(DELETE_RETRY_AFTER_SECONDS));
      }
      throw err;
    }
  }
}
