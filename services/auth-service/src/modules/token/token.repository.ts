/**
 * SQL access for OAuth/token flows: platform `api_clients` / `platform_users`,
 * per-tenant `tenant_users` / `tenant_roles` / `tenant_role_permissions`.
 */
import { Inject, Injectable } from "@nestjs/common";
import { AuthTenantConnectionManager } from "../../providers/auth-tenant-connection-manager";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";

@Injectable()
export class TokenRepository {
  constructor(
    @Inject(POSTGRES_SQL) private readonly platformSql: Sql,
    @Inject(AuthTenantConnectionManager)
    private readonly tenantSql: AuthTenantConnectionManager,
  ) {}

  private async sqlFor(tenantId: string) {
    return this.tenantSql.ensureSchema(tenantId);
  }

  findClientByClientId(clientId: string): ReturnType<Sql> {
    return this.platformSql`
      SELECT id, client_secret_hash, scope, is_active
      FROM api_clients
      WHERE client_id = ${clientId}
      LIMIT 1
    `;
  }

  findPlatformUserById(userId: string): ReturnType<Sql> {
    return this.platformSql`
      SELECT id, email, role, is_active
      FROM platform_users
      WHERE id = ${userId}
      LIMIT 1
    `;
  }

  async findTenantUserForRefresh(
    tenantId: string,
    userId: string,
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT tu.id, tu.email, tu.is_active,
             tr.name AS role_name, tr.is_system
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.id = ${userId}
      LIMIT 1
    `;
  }

  findPlatformUserByEmail(email: string): ReturnType<Sql> {
    return this.platformSql`
      SELECT id, email, password_hash, role, is_active
      FROM platform_users
      WHERE email = ${email}
      LIMIT 1
    `;
  }

  async findTenantUserWithTenant(
    email: string,
    tenantId: string,
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
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
    const tenantRows = await this.platformSql<{ name: string }[]>`
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
          {
            id: string;
            email: string;
            password_hash: string;
            role_name: string;
            is_system: boolean;
          }[]
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
          // Caller only needs 0 / 1 / many; avoid scanning all tenants after ambiguity.
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
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT trp.resource, trp.action
      FROM tenant_role_permissions trp
      JOIN tenant_users tu ON tu.role_id = trp.role_id
      WHERE tu.id = ${userId}
    `;
  }
}
