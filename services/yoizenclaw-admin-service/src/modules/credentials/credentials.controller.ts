import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { CredentialsService } from "./credentials.service";
import {
  CreateCredentialDto,
  UpdateCredentialDto,
  ListCredentialsQueryDto,
  RotateCredentialDto,
} from "./credentials.dto";
import type { CredentialWithoutValue } from "./credentials.repository";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

@Controller("admin/credentials")
@UseGuards(TenantGuard)
export class CredentialsController {
  constructor(private readonly service: CredentialsService) {}

  /**
   * Lists credentials with optional filters.
   * GET /admin/credentials?type=api_key&limit=20&offset=0
   * Never returns the `value` field.
   */
  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @Query() query: ListCredentialsQueryDto,
  ): Promise<{ credentials: CredentialWithoutValue[]; total: number }> {
    return this.service.findAll(tenantId, {
      type: query.type,
      is_active: query.is_active,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Returns a credential by ID.
   * GET /admin/credentials/:id
   * Never returns the `value` field.
   */
  @Get(":id")
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<CredentialWithoutValue> {
    return this.service.findById(tenantId, id);
  }

  /**
   * Creates a credential.
   * POST /admin/credentials
   * FIXME: Encrypt with KMS/Vault before production
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateCredentialDto,
  ): Promise<CredentialWithoutValue> {
    return this.service.create(tenantId, {
      name: dto.name,
      type: dto.type,
      value: dto.value,
      metadata: dto.metadata,
      expires_at: dto.expires_at,
      is_active: dto.is_active,
    });
  }

  /**
   * Updates an existing credential.
   * PUT /admin/credentials/:id
   * Emits credential.rotated when `value` changes.
   * FIXME: Encrypt with KMS/Vault before production
   */
  @Put(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateCredentialDto,
  ): Promise<CredentialWithoutValue> {
    return this.service.update(tenantId, id, {
      name: dto.name,
      type: dto.type,
      value: dto.value,
      metadata: dto.metadata,
      expires_at: dto.expires_at,
      is_active: dto.is_active,
    });
  }

  /**
   * Soft-deletes a credential.
   * DELETE /admin/credentials/:id
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }

  /**
   * Rotates a credential value.
   * PUT /admin/credentials/:id/rotate
   * Emits credential.rotated on success.
   * FIXME: Encrypt with KMS/Vault before production
   */
  @Put(":id/rotate")
  async rotate(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: RotateCredentialDto,
  ): Promise<CredentialWithoutValue> {
    return this.service.rotate({
      tenantId,
      id,
      newValue: dto.new_value,
      newExpiresAt: dto.new_expires_at,
    });
  }
}
