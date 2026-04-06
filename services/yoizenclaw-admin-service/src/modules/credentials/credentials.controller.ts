import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import { CredentialsService } from './credentials.service';
import { CredentialSyncService } from './credential-sync.service';
import {
  CreateProviderCredentialDto,
  UpdateProviderCredentialDto,
  ListCredentialsQueryDto,
  RotateCredentialDto,
  SyncCredentialsDto,
} from './credentials.dto';
import { PROVIDER_SCHEMAS } from './providers/credential-provider.registry';
import type { MaskedCredential, SyncStatus } from './credentials.repository';
import { CURRENT_SCHEMA_VERSION } from './credentials.service';

@Controller('admin/credentials')
export class CredentialsController {
  constructor(
    private readonly service: CredentialsService,
    private readonly syncService: CredentialSyncService,
  ) {}

  /**
   * Get all supported credential providers.
   * GET /admin/credentials/providers
   * Returns provider schemas for UI form rendering.
   */
  @Get('providers')
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

  /**
   * List all credentials with optional filters.
   * GET /admin/credentials?provider=openai&sync_status=synced&limit=20&offset=0
   * Returns masked credentials (secrets are never exposed).
   */
  @Get()
  async findAll(
    @Headers(TENANT_HEADER) tenantId: string,
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

  /**
   * Get a credential by ID.
   * GET /admin/credentials/:id
   * Returns masked credential (secrets are never exposed).
   */
  @Get(':id')
  async findById(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<MaskedCredential> {
    return this.service.findById(tenantId, id);
  }

  /**
   * Create a new provider-aware credential.
   * POST /admin/credentials
   * Validates payload against provider schema before saving.
   * TODO(security): Encrypt payloads with KMS/Vault before production
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
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

  /**
   * Update a credential with partial update support.
   * PUT /admin/credentials/:id
   * Preserves existing secret values when not explicitly replaced.
   * TODO(security): Encrypt payloads with KMS/Vault before production
   */
  @Put(':id')
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
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

  /**
   * Soft delete a credential.
   * DELETE /admin/credentials/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }

  /**
   * Rotate credential secrets (full payload replacement).
   * PUT /admin/credentials/:id/rotate
   * Replaces all secret values and triggers a sync to runtime.
   * TODO(security): Encrypt payloads with KMS/Vault before production
   */
  @Put(':id/rotate')
  async rotate(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
    @Body() dto: RotateCredentialDto,
  ): Promise<MaskedCredential> {
    return this.service.rotate(tenantId, id, dto.payload, dto.new_expires_at);
  }

  /**
   * Trigger manual sync of credentials to runtime.
   * POST /admin/credentials/sync
   * Enqueues all active credentials for sync to runtime-secrets/credentials.env.
   */
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async sync(
    @Headers(TENANT_HEADER) tenantId: string,
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
      message: 'Credential sync completed',
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
