import { Injectable } from '@nestjs/common';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';

export type CredentialType = 'api_key' | 'oauth' | 'basic' | 'custom';

/**
 * Credential entity - NUNCA expuesto con campo 'value' en API responses
 * FIXME: Implementar cifrado con KMS/Vault - actualmente is_encrypted=false
 */
export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  value: string; // Campo sensible - solo usado internamente
  is_encrypted: boolean;
  metadata: Record<string, unknown>;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Credential sin campo value - versión segura para API responses
 */
export interface CredentialWithoutValue {
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

export interface CreateCredentialData {
  name: string;
  type: CredentialType;
  value: string;
  metadata?: Record<string, unknown>;
  expires_at?: string;
  is_active?: boolean;
}

export interface UpdateCredentialData {
  name?: string;
  type?: CredentialType;
  value?: string;
  metadata?: Record<string, unknown>;
  expires_at?: string | null;
  is_active?: boolean;
}

export interface FindAllOptions {
  type?: CredentialType;
  is_active?: boolean;
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

  private getSql(tenantId: string): Sql {
    return this.connectionManager.getConnection(tenantId);
  }

  /**
   * Lista todas las credenciales con filtros opcionales y paginación.
   * Retorna credentials SIN el campo value por seguridad.
   */
  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ credentials: CredentialWithoutValue[]; total: number }> {
    const sql = this.getSql(tenantId);
    const { type, limit = 20, offset = 0 } = options;

    // Build where clause with parameterized conditions
    const conditions: string[] = ['is_active = true'];
    const params: (string | boolean | number)[] = [];
    let paramIndex = 1;

    if (type) {
      conditions.push(`type = $${paramIndex}`);
      params.push(type);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM credentials WHERE ${sql.unsafe(whereClause)}
    `;
    const total = Number(countResult[0].count);

    // Get credentials WITHOUT value field (security)
    const credentials = await sql<CredentialWithoutValue[]>`
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
      WHERE ${sql.unsafe(whereClause)}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return { credentials, total };
  }

  /**
   * Busca una credencial por su ID.
   * Retorna credential SIN el campo value por seguridad.
   */
  async findById(
    tenantId: string,
    id: string,
  ): Promise<CredentialWithoutValue | null> {
    const sql = this.getSql(tenantId);

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
   * Busca una credencial por su ID incluyendo el campo value.
   * ⚠️ Solo usar internamente, NUNCA exponer en API responses.
   */
  async findByIdWithValue(
    tenantId: string,
    id: string,
  ): Promise<Credential | null> {
    const sql = this.getSql(tenantId);

    const results = await sql<Credential[]>`
      SELECT 
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
      FROM credentials
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Crea una nueva credencial.
   * FIXME: Implementar cifrado con KMS/Vault - actualmente guarda plaintext
   */
  async create(
    tenantId: string,
    data: CreateCredentialData,
  ): Promise<CredentialWithoutValue> {
    const sql = this.getSql(tenantId);

    // FIXME: Implementar cifrado con KMS/Vault antes de producción
    // Por ahora, is_encrypted siempre es false (placeholder)
    const isEncrypted = false;

    const results = await sql<CredentialWithoutValue[]>`
      INSERT INTO credentials (
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
   * Actualiza una credencial existente.
   * FIXME: Implementar cifrado con KMS/Vault antes de producción
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateCredentialData,
  ): Promise<CredentialWithoutValue | null> {
    const sql = this.getSql(tenantId);

    // Build dynamic update using sql for proper parameterization
    const updates: string[] = ['updated_at = NOW()'];
    
    if (data.name !== undefined) {
      updates.push(sql`name = ${data.name}` as unknown as string);
    }
    if (data.type !== undefined) {
      updates.push(sql`type = ${data.type}` as unknown as string);
    }
    if (data.value !== undefined) {
      // FIXME: Implementar cifrado con KMS/Vault antes de producción
      // Al actualizar el value, is_encrypted sigue siendo false (placeholder)
      updates.push(sql`value = ${data.value}` as unknown as string);
      updates.push(sql`is_encrypted = ${false}` as unknown as string);
    }
    if (data.metadata !== undefined) {
      updates.push(sql`metadata = ${sql.json(data.metadata as JsonValue)}` as unknown as string);
    }
    if (data.expires_at !== undefined) {
      updates.push(sql`expires_at = ${data.expires_at ? new Date(data.expires_at) : null}` as unknown as string);
    }
    if (data.is_active !== undefined) {
      updates.push(sql`is_active = ${data.is_active}` as unknown as string);
    }

    const setClause = updates.join(', ');

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
   * Elimina (soft delete) una credencial.
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = this.getSql(tenantId);

    const results = await sql<CredentialWithoutValue[]>`
      UPDATE credentials
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;

    return results.length > 0;
  }

  /**
   * Rota el valor de una credencial (actualiza value y updated_at).
   * Emite evento credential.rotated después de llamar a esto.
   * FIXME: Implementar cifrado con KMS/Vault antes de producción
   */
  async rotate(
    tenantId: string,
    id: string,
    newValue: string,
    newExpiresAt?: string,
  ): Promise<CredentialWithoutValue | null> {
    const sql = this.getSql(tenantId);

    // FIXME: Implementar cifrado con KMS/Vault antes de producción
    // Por ahora, is_encrypted sigue siendo false (placeholder)

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
