import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "@yoizen/shared";
import {
  appendSqlSetFragment,
  composeUpdateSetClause,
} from "../../common/repository-sql.util";
import { TenantScopedRepository } from "../../providers/tenant-scoped.repository";
import { TenantConnectionManager } from "@yoizen/database";
import type { CredentialType } from "./credentials.dto";

/**
 * Credential entity — never expose `value` in API responses.
 * FIXME: Implement encryption with KMS/Vault — currently is_encrypted=false.
 */
export interface ICredential {
  id: string;
  name: string;
  type: CredentialType;
  value: string; // Sensitive — internal use only
  is_encrypted: boolean;
  metadata: Record<string, unknown>;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Credential without `value` — safe shape for API responses.
 */
export interface ICredentialWithoutValue {
  id: string;
  name: string;
  type: CredentialType;
  is_encrypted: boolean;
  metadata: Record<string, unknown>;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateCredentialData {
  name: string;
  type: CredentialType;
  value: string;
  metadata?: Record<string, unknown>;
  expires_at?: string;
  is_active?: boolean;
}

export interface IUpdateCredentialData {
  name?: string;
  type?: CredentialType;
  value?: string;
  metadata?: Record<string, unknown>;
  expires_at?: string | null;
  is_active?: boolean;
}

export interface IFindAllOptions {
  type?: CredentialType;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export type CredentialWithoutValue = ICredentialWithoutValue;
export type CreateCredentialData = ICreateCredentialData;
export type UpdateCredentialData = IUpdateCredentialData;

@Injectable()
export class CredentialsRepository extends TenantScopedRepository {
  constructor(connectionManager: TenantConnectionManager) {
    super(connectionManager);
  }

  /**
   * Lists credentials with optional filters and pagination.
   * Returns rows without `value` for safety.
   */
  async findAll(
    tenantId: string,
    options: IFindAllOptions = {},
  ): Promise<{ credentials: CredentialWithoutValue[]; total: number }> {
    const sql = await this.getSql(tenantId);
    const {
      type,
      is_active: isActiveFilter,
      limit = 20,
      offset = 0,
    } = options;

    /** When omitted, list only active rows (soft-delete default). */
    const isActiveEq = isActiveFilter === undefined ? true : isActiveFilter;

    // Get total count
    const countResult = type
      ? await sql<{ count: string | number }[]>`
      SELECT COUNT(*)::bigint AS count FROM credentials
      WHERE is_active = ${isActiveEq} AND type = ${type}
    `
      : await sql<{ count: string | number }[]>`
      SELECT COUNT(*)::bigint AS count FROM credentials
      WHERE is_active = ${isActiveEq}
    `;
    const total = Number(countResult[0].count);

    // Get credentials WITHOUT value field (security)
    const credentials = type
      ? await sql<CredentialWithoutValue[]>`
      SELECT 
        id,
        name,
        type,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        created_at,
        updated_at
      FROM credentials
      WHERE is_active = ${isActiveEq} AND type = ${type}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `
      : await sql<CredentialWithoutValue[]>`
      SELECT 
        id,
        name,
        type,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        created_at,
        updated_at
      FROM credentials
      WHERE is_active = ${isActiveEq}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return { credentials, total };
  }

  /**
   * Finds a credential by ID (without `value`).
   */
  async findById(
    tenantId: string,
    id: string,
  ): Promise<CredentialWithoutValue | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<CredentialWithoutValue[]>`
      SELECT 
        id,
        name,
        type,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        created_at,
        updated_at
      FROM credentials
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Creates a credential.
   * FIXME: Encrypt with KMS/Vault — currently stores plaintext.
   */
  async create(
    tenantId: string,
    data: CreateCredentialData,
  ): Promise<CredentialWithoutValue> {
    const sql = await this.getSql(tenantId);
    const credentialId = randomUUID();

    // FIXME: Encrypt with KMS/Vault before production
    // For now is_encrypted stays false (placeholder)
    const isEncrypted = false;

    const results = await sql<CredentialWithoutValue[]>`
      INSERT INTO credentials (
        id,
        name,
        type,
        value,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        ${credentialId},
        ${data.name},
        ${data.type},
        ${data.value},
        ${isEncrypted},
        ${sql.json((data.metadata ?? {}) as JsonValue)},
        ${data.expires_at ? new Date(data.expires_at) : null},
        ${data.is_active ?? true},
        NOW(),
        NOW()
      )
      RETURNING 
        id,
        name,
        type,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        created_at,
        updated_at
    `;

    return results[0];
  }

  /**
   * Updates an existing credential.
   * FIXME: Encrypt with KMS/Vault before production
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateCredentialData,
  ): Promise<CredentialWithoutValue | null> {
    const sql = await this.getSql(tenantId);

    const updates: string[] = [];
    appendSqlSetFragment(updates, sql`updated_at = NOW()`);

    if (data.name !== undefined) {
      appendSqlSetFragment(updates, sql`name = ${data.name}`);
    }
    if (data.type !== undefined) {
      appendSqlSetFragment(updates, sql`type = ${data.type}`);
    }
    if (data.value !== undefined) {
      // FIXME: Encrypt with KMS/Vault before production
      appendSqlSetFragment(updates, sql`value = ${data.value}`);
      appendSqlSetFragment(updates, sql`is_encrypted = ${false}`);
    }
    if (data.metadata !== undefined) {
      appendSqlSetFragment(
        updates,
        sql`metadata = ${sql.json(data.metadata as JsonValue)}`,
      );
    }
    if (data.expires_at !== undefined) {
      appendSqlSetFragment(
        updates,
        sql`expires_at = ${data.expires_at ? new Date(data.expires_at) : null}`,
      );
    }
    if (data.is_active !== undefined) {
      appendSqlSetFragment(
        updates,
        sql`is_active = ${data.is_active}`,
      );
    }

    const setClause = composeUpdateSetClause(updates);

    const results = await sql<CredentialWithoutValue[]>`
      UPDATE credentials
      SET ${sql.unsafe(setClause)}
      WHERE id = ${id} AND is_active = true
      RETURNING 
        id,
        name,
        type,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }

  /**
   * Soft-deletes a credential.
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.getSql(tenantId);

    const results = await sql<CredentialWithoutValue[]>`
      UPDATE credentials
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;

    return results.length > 0;
  }

  /**
   * Rotates a credential value (updates value and updated_at).
   * Emit credential.rotated after calling this.
   * FIXME: Encrypt with KMS/Vault before production
   */
  async rotate(options: {
    tenantId: string;
    id: string;
    newValue: string;
    newExpiresAt?: string;
  }): Promise<CredentialWithoutValue | null> {
    const { tenantId, id, newValue, newExpiresAt } = options;
    const sql = await this.getSql(tenantId);

    // FIXME: Encrypt with KMS/Vault before production
    // For now is_encrypted remains false (placeholder)

    const results = await sql<CredentialWithoutValue[]>`
      UPDATE credentials
      SET 
        value = ${newValue},
        is_encrypted = ${false},
        expires_at = ${newExpiresAt ? new Date(newExpiresAt) : null},
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING 
        id,
        name,
        type,
        is_encrypted,
        metadata,
        expires_at,
        is_active,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }
}
