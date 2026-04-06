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
  Headers,
} from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { CredentialsService } from "./credentials.service";
import { CredentialSyncService } from "./credential-sync.service";
import {
  CreateProviderCredentialDto,
  UpdateProviderCredentialDto,
  ListCredentialsQueryDto,
  RotateCredentialDto,
  SyncCredentialsDto,
} from "./credentials.dto";
import { PROVIDER_SCHEMAS } from "./providers/credential-provider.registry";
import type { MaskedCredential, SyncStatus } from "./credentials.repository";
import { CURRENT_SCHEMA_VERSION } from "./credentials.service";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

@Controller("admin/credentials")
@UseGuards(TenantGuard)
export class CredentialsController {
  constructor(
    private readonly service: CredentialsService,
    private readonly syncService: CredentialSyncService,
  ) {}

  @Get("providers")
  async getProviders(): Promise<{
    providers: Array<{
      provider: string;
      display_name: string;
      description: string;
      fields: Array<{
        name: string;
        type: string;
        required: boolean;
        secret: boolean;
        description: string;
        placeholder?: string;
      }>;
    }>;
  }> {
    return {
      providers: PROVIDER_SCHEMAS.map((schema) => ({
        provider: schema.provider,
        display_name: schema.displayName,
        description: schema.description,
        fields: schema.fields.map((field) => ({
          name: field.name,
          type: field.type,
          required: field.required,
          secret: field.secret,
          description: field.description,
          placeholder: field.placeholder,
        })),
      })),
    };
  }

  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @Query() query: ListCredentialsQueryDto,
  ): Promise<{ credentials: MaskedCredential[]; total: number }> {
    return this.service.findAll(tenantId, {
      provider: query.provider,
      is_active: query.is_active,
      sync_status: query.sync_status as SyncStatus,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(":id")
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<MaskedCredential> {
    return this.service.findById(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateProviderCredentialDto,
  ): Promise<MaskedCredential> {
    return this.service.create(tenantId, {
      name: dto.name,
      provider: dto.provider,
      payload: dto.payload,
      schema_version: CURRENT_SCHEMA_VERSION,
      metadata: dto.metadata,
      expires_at: dto.expires_at,
      is_active: dto.is_active,
    });
  }

  @Put(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateProviderCredentialDto,
  ): Promise<MaskedCredential> {
    return this.service.update(tenantId, id, {
      name: dto.name,
      provider: dto.provider,
      payload: dto.payload,
      metadata: dto.metadata,
      expires_at: dto.expires_at,
      is_active: dto.is_active,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }

  @Put(":id/rotate")
  async rotate(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: RotateCredentialDto,
  ): Promise<MaskedCredential> {
    return this.service.rotate(tenantId, id, dto.payload, dto.new_expires_at);
  }

  @Post("sync")
  @HttpCode(HttpStatus.ACCEPTED)
  async sync(
    @TenantId() tenantId: string,
    @Body() dto: SyncCredentialsDto,
  ): Promise<{
    message: string;
    triggered: boolean;
    results: { credentialId: string; success: boolean; error?: string }[];
    summary: { successful: number; failed: number; total: number };
  }> {
    const result = await this.syncService.syncAllCredentials(tenantId, {
      failedOnly: dto.failed_only,
    });

    const successful = result.results.filter((r) => r.success).length;
    const failed = result.results.filter((r) => !r.success).length;

    return {
      message: "Credential sync completed",
      triggered: true,
      results: result.results,
      summary: {
        successful,
        failed,
        total: result.results.length,
      },
    };
  }
}
