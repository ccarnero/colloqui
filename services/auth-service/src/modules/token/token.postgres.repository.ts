/**
 * SQL access for OAuth/token flows: platform `api_clients` / `platform_users`,
 * per-tenant `tenant_users` / `tenant_roles` / `tenant_role_permissions`.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { AuthTenantConnectionManager } from "../../providers/auth-tenant-connection-manager";
import { POSTGRES_SQL, type Sql } from "@yoizen/database";
import type { ITokenRepository } from "./token.repository.interface";

@Injectable()
export class TokenPostgresRepository implements ITokenRepository {
  constructor(
    @Inject(POSTGRES_SQL) private readonly platformSql: Sql,
    @Inject(AuthTenantConnectionManager)
    private readonly tenantSql: TenantConnectionManager,
  ) {}

  private async sqlFor(tenantId: string) {
    return this.tenantSql.ensureSchema(tenantId);
  }

  async findClientByClientId(clientId: string): Promise<
    Array<{
      id: string;
      client_secret_hash: string;
      scope: string;
      is_active: boolean;
    }>
  > {
    return this.platformSql<
      Array<{
        id: string;
        client_secret_hash: string;
        scope: string;
        is_active: boolean;
      }>
    >`
      SELECT id, client_secret_hash, scope, is_active
      FROM api_clients
      WHERE client_id = ${clientId}
      LIMIT 1
    `;
  }

  async findPlatformUserById(userId: string): Promise<
    Array<{
      id: string;
      email: string;
      role: string;
      is_active: boolean;
    }>
  > {
    return this.platformSql<
      Array<{
        id: string;
        email: string;
        role: string;
        is_active: boolean;
      }>
    >`
      SELECT id, email, role, is_active
      FROM platform_users
      WHERE id = ${userId}
      LIMIT 1
    `;
  }

  async findTenantUserForRefresh(
    tenantId: string,
    userId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      is_active: boolean;
      role_name: string;
      is_system: boolean;
    }>
  > {
    const sql = await this.sqlFor(tenantId);
    return sql<
      Array<{
        id: string;
        email: string;
        is_active: boolean;
        role_name: string;
        is_system: boolean;
      }>
    >`
      SELECT tu.id, tu.email, tu.is_active,
             tr.name AS role_name, tr.is_system
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.id = ${userId}
      LIMIT 1
    `;
  }

  async findPlatformUserByEmail(email: string): Promise<
    Array<{
      id: string;
      email: string;
      password_hash: string;
      role: string;
      is_active: boolean;
    }>
  > {
    return this.platformSql<
      Array<{
        id: string;
        email: string;
        password_hash: string;
        role: string;
        is_active: boolean;
      }>
    >`
      SELECT id, email, password_hash, role, is_active
      FROM platform_users
      WHERE email = ${email}
      LIMIT 1
    `;
  }

  async findTenantUserWithTenant(
    email: string,
    tenantId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      password_hash: string;
      role_name: string;
      is_system: boolean;
    }>
  > {
    const sql = await this.sqlFor(tenantId);
    return sql<
      Array<{
        id: string;
        email: string;
        password_hash: string;
        role_name: string;
        is_system: boolean;
      }>
    >`
      SELECT tu.id, tu.email, tu.password_hash,
             tr.name AS role_name, tr.is_system
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.email = ${email}
        AND tu.is_active = true
      LIMIT 1
    `;
  }

  /**
   * Probes each tenant DB (O(n) tenants) — only used for password login without tenant hint.
   */
  async findTenantUserByEmailAnyTenant(
    email: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      password_hash: string;
      role_name: string;
      is_system: boolean;
      tenant_id: string;
    }>
  > {
    const tenantRows = await this.platformSql<Array<{ name: string }>>`
      SELECT name
      FROM tenants
      WHERE provisioning_status = 'ready'
      ORDER BY name
    `;
    const out: Array<{
      id: string;
      email: string;
      password_hash: string;
      role_name: string;
      is_system: boolean;
      tenant_id: string;
    }> = [];

    for (const { name: tenantName } of tenantRows) {
      try {
        const sql = await this.sqlFor(tenantName);
        const rows = await sql<
          Array<{
            id: string;
            email: string;
            password_hash: string;
            role_name: string;
            is_system: boolean;
          }>
        >`
          SELECT tu.id, tu.email, tu.password_hash,
                 tr.name AS role_name, tr.is_system
          FROM tenant_users tu
          JOIN tenant_roles tr ON tr.id = tu.role_id
          WHERE tu.email = ${email} AND tu.is_active = true
          LIMIT 1
        `;
        if (rows.length > 0) {
          out.push({ ...rows[0], tenant_id: tenantName });
          if (out.length > 1) {
            break;
          }
        }
      } catch {
        // Best-effort probe: unreachable tenant DBs must not turn invalid login into 500.
      }
    }
    return out;
  }

  async resolvePermissionsForUser(
    tenantId: string,
    userId: string,
  ): Promise<Array<{ resource: string; action: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ resource: string; action: string }>>`
      SELECT trp.resource, trp.action
      FROM tenant_role_permissions trp
      JOIN tenant_users tu ON tu.role_id = trp.role_id
      WHERE tu.id = ${userId}
    `;
  }
}
