import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';
import { getSecretFields, type CredentialProvider } from './providers/credential-provider.registry';

export type SyncStatus = 'pending' | 'synced' | 'failed' | 'manual_review_required';

/**
 * Provider-aware credential entity
 * Core domain model for credentials with provider-specific payloads
 */
export interface ProviderCredential {
  id: string;
  name: string;
  provider: CredentialProvider;
  schema_version: number;
  payload: Record<string, unknown>;
  is_encrypted: boolean;
  metadata: Record<string, unknown>;
  expires_at: Date | null;
  is_active: boolean;
  sync_status: SyncStatus;
  last_sync_at: Date | null;
  sync_error: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Masked credential - safe for API responses. Secret fields are replaced with asterisks.
 */
export interface MaskedCredential {
  id: string;
  name: string;
  provider: CredentialProvider;
  schema_version: number;
  payload: Record<string, unknown>;
  is_encrypted: boolean;
  metadata: Record<string, unknown>;
  expires_at: Date | null;
  is_active: boolean;
  sync_status: SyncStatus;
  last_sync_at: Date | null;
  sync_error: string | null;
  has_secret: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProviderCredentialData {
  name: string;
  provider: CredentialProvider;
  schema_version: number;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expires_at?: string;
  is_active?: boolean;
}

export interface UpdateProviderCredentialData {
  name?: string;
  provider?: CredentialProvider;
  schema_version?: number;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expires_at?: string | null;
  is_active?: boolean;
  sync_status?: SyncStatus;
  sync_error?: string | null;
}

export interface FindAllOptions {
  provider?: CredentialProvider;
  is_active?: boolean;
  sync_status?: SyncStatus;
  limit?: number;
  offset?: number;
}

// Helper type for JSON values compatible with postgres.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

@Injectable()
export class CredentialsRepository {
  constructor(
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  private async getSql(tenantId: string): Promise<Sql> {
    await this.connectionManager.ensureSchema(tenantId);
    return this.connectionManager.getConnection(tenantId);
  }

  /**
   * List all credentials with optional filters and pagination.
   * Returns credentials with masked payloads (no plaintext secrets).
   */
  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ credentials: MaskedCredential[]; total: number }> {
    const sql = await this.getSql(tenantId);
    const { provider, is_active, sync_status, limit = 20, offset = 0 } = options;

    // Default to active credentials unless explicitly overridden
    const activeCondition = is_active !== undefined ? is_active : true;

    // Get total count
    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM credentials
      WHERE is_active = ${activeCondition}
      ${provider ? sql`AND provider = ${provider}` : sql``}
      ${sync_status ? sql`AND sync_status = ${sync_status}` : sql``}
    `;
    const total = Number(countResult[0].count);

    // Get credentials without sensitive payload fields
    const credentials = await sql<MaskedCredential[]>`
      SELECT
        id,
        name,
        provider,
        schema_version,
        payload,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        sync_status,
        last_sync_at,
        sync_error,
        created_at,
        updated_at
      FROM credentials
      WHERE is_active = ${activeCondition}
      ${provider ? sql`AND provider = ${provider}` : sql``}
      ${sync_status ? sql`AND sync_status = ${sync_status}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Determine has_secret from payload (check if secret fields have values)
    const credentialsWithSecretFlag = credentials.map((cred) => ({
      ...cred,
      has_secret: this.hasSecretValues(cred.provider, cred.payload),
    }));

    return { credentials: credentialsWithSecretFlag, total };
  }

  /**
   * Find credential by ID (without sensitive data)
   */
  async findById(
    tenantId: string,
    id: string,
  ): Promise<MaskedCredential | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<MaskedCredential[]>`
      SELECT 
        id,
        name,
        provider,
        schema_version,
        payload,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        sync_status,
        last_sync_at,
        sync_error,
        created_at,
        updated_at
      FROM credentials
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    if (!results[0]) return null;

    return {
      ...results[0],
      has_secret: this.hasSecretValues(results[0].provider, results[0].payload),
    };
  }

  /**
   * Find credential by ID with full payload (including secrets).
   * ⚠️ Only use internally for sync operations. NEVER expose in API responses.
   */
  async findByIdWithPayload(
    tenantId: string,
    id: string,
  ): Promise<ProviderCredential | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<ProviderCredential[]>`
      SELECT 
        id,
        name,
        provider,
        schema_version,
        payload,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        sync_status,
        last_sync_at,
        sync_error,
        created_at,
        updated_at
      FROM credentials
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Find all active credentials for sync operations.
   * Returns full payloads with secrets for runtime materialization.
   */
  async findAllForSync(
    tenantId: string,
  ): Promise<ProviderCredential[]> {
    const sql = await this.getSql(tenantId);

    const results = await sql<ProviderCredential[]>`
      SELECT
        id,
        name,
        provider,
        schema_version,
        payload,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        sync_status,
        last_sync_at,
        sync_error,
        created_at,
        updated_at
      FROM credentials
      WHERE is_active = true
        AND sync_status != 'manual_review_required'
      ORDER BY name ASC
    `;

    return results;
  }

  /**
   * Create a new provider-aware credential.
   * TODO(security): Encrypt payloads with KMS/Vault before production
   */
  async create(
    tenantId: string,
    data: CreateProviderCredentialData,
  ): Promise<MaskedCredential> {
    const sql = await this.getSql(tenantId);
    const credentialId = randomUUID();

    const isEncrypted = false;

    // Set initial sync status to pending
    const syncStatus: SyncStatus = 'pending';

    const results = await sql<MaskedCredential[]>`
      INSERT INTO credentials (
        id,
        name,
        provider,
        schema_version,
        payload,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        sync_status,
        last_sync_at,
        sync_error,
        created_at,
        updated_at
      ) VALUES (
        ${credentialId},
        ${data.name},
        ${data.provider},
        ${data.schema_version},
        ${sql.json(data.payload as JsonValue)},
        ${isEncrypted},
        ${sql.json((data.metadata ?? {}) as JsonValue)},
        ${data.expires_at ? new Date(data.expires_at) : null},
        ${data.is_active ?? true},
        ${syncStatus},
        NULL,
        NULL,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        name,
        provider,
        schema_version,
        payload,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        sync_status,
        last_sync_at,
        sync_error,
        created_at,
        updated_at
    `;

    return {
      ...results[0],
      has_secret: this.hasSecretValues(results[0].provider, results[0].payload),
    };
  }

  /**
   * Update a credential with partial update support.
   * Preserves existing secret values when not explicitly replaced.
   * TODO(security): Encrypt payloads with KMS/Vault before production
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateProviderCredentialData,
  ): Promise<MaskedCredential | null> {
    const sql = await this.getSql(tenantId);

    // Determine sync_status updates
    let syncStatus = data.sync_status;
    if (data.payload !== undefined && !syncStatus) {
      syncStatus = 'pending';
    }

    const isSynced = syncStatus === 'synced';

    const results = await sql<MaskedCredential[]>`
      UPDATE credentials
      SET
        name = COALESCE(${data.name !== undefined ? data.name : null}, name),
        provider = COALESCE(${data.provider !== undefined ? data.provider : null}, provider),
        schema_version = COALESCE(${data.schema_version !== undefined ? data.schema_version : null}, schema_version),
        payload = COALESCE(${data.payload !== undefined ? sql.json(data.payload as JsonValue) : null}, payload),
        metadata = COALESCE(${data.metadata !== undefined ? sql.json(data.metadata as JsonValue) : null}, metadata),
        expires_at = COALESCE(${data.expires_at !== undefined ? data.expires_at ? new Date(data.expires_at) : null : null}, expires_at),
        is_active = COALESCE(${data.is_active !== undefined ? data.is_active : null}, is_active),
        sync_status = COALESCE(${syncStatus !== undefined ? syncStatus : null}, sync_status),
        last_sync_at = ${isSynced ? sql`NOW()` : sql`last_sync_at`},
        sync_error = ${isSynced ? sql`NULL` : sql`COALESCE(${data.sync_error !== undefined ? data.sync_error : null}, sync_error)`},
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING
        id,
        name,
        provider,
        schema_version,
        payload,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        sync_status,
        last_sync_at,
        sync_error,
        created_at,
        updated_at
    `;

    if (!results[0]) return null;

    return {
      ...results[0],
      has_secret: this.hasSecretValues(results[0].provider, results[0].payload),
    };
  }

  /**
   * Soft delete a credential.
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.getSql(tenantId);

    const results = await sql<{ id: string }[]>`
      UPDATE credentials
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;

    return results.length > 0;
  }

  /**
   * Rotate credential secrets (full payload replacement).
   * TODO(security): Encrypt payloads with KMS/Vault before production
   */
  async rotate(
    tenantId: string,
    id: string,
    newPayload: Record<string, unknown>,
    newExpiresAt?: string,
  ): Promise<MaskedCredential | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<MaskedCredential[]>`
      UPDATE credentials
      SET 
        payload = ${sql.json(newPayload as JsonValue)},
        is_encrypted = ${false},
        expires_at = ${newExpiresAt ? new Date(newExpiresAt) : null},
        sync_status = ${'pending'},
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING 
        id,
        name,
        provider,
        schema_version,
        payload,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        sync_status,
        last_sync_at,
        sync_error,
        created_at,
        updated_at
    `;

    if (!results[0]) return null;

    return {
      ...results[0],
      has_secret: this.hasSecretValues(results[0].provider, results[0].payload),
    };
  }

  /**
   * Update sync status for a credential.
   */
  async updateSyncStatus(
    tenantId: string,
    id: string,
    status: SyncStatus,
    error?: string,
  ): Promise<boolean> {
    const sql = await this.getSql(tenantId);

    const lastSyncAt = status === 'synced' ? new Date() : null;

    const results = await sql<{ id: string }[]>`
      UPDATE credentials
      SET 
        sync_status = ${status},
        last_sync_at = ${lastSyncAt},
        sync_error = ${error ?? null},
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;

    return results.length > 0;
  }

  /**
   * Check if payload contains actual secret values for the given provider.
   */
  private hasSecretValues(provider: CredentialProvider, payload: Record<string, unknown>): boolean {
    if (!payload || typeof payload !== 'object' || !provider) return false;

    const secretFields = getSecretFields(provider);
    return secretFields.some((field) => {
      const value = payload[field];
      return value !== null && value !== undefined && value !== '';
    });
  }
}
