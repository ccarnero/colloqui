/**
 * SQL access for OAuth/token flows (`api_clients`, `platform_users`, `tenant_users`).
 */
import { Inject, Injectable } from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";

@Injectable()
export class TokenRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  findClientByClientId(clientId: string) {
    return this.sql`
      SELECT id, client_secret_hash, scope, is_active
      FROM api_clients
      WHERE client_id = ${clientId}
      LIMIT 1
    `;
  }

  findPlatformUserById(userId: string) {
    return this.sql`
      SELECT id, email, role, is_active
      FROM platform_users
      WHERE id = ${userId}
      LIMIT 1
    `;
  }

  findTenantUserForRefresh(userId: string) {
    return this.sql`
      SELECT tu.id, tu.tenant_id, tu.email, tu.is_active,
             tr.name AS role_name, tr.is_system
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.id = ${userId}
      LIMIT 1
    `;
  }

  findPlatformUserByEmail(email: string) {
    return this.sql`
      SELECT id, email, password_hash, role, is_active
      FROM platform_users
      WHERE email = ${email}
      LIMIT 1
    `;
  }

  findTenantUserWithTenant(email: string, tenantId: string) {
    return this.sql`
      SELECT tu.id, tu.tenant_id, tu.email, tu.password_hash,
             tr.name AS role_name, tr.is_system
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.email = ${email}
        AND tu.tenant_id = ${tenantId}
        AND tu.is_active = true
      LIMIT 1
    `;
  }

  findTenantUserByEmailAnyTenant(email: string) {
    return this.sql`
      SELECT tu.id, tu.tenant_id, tu.email, tu.password_hash,
             tr.name AS role_name, tr.is_system
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.email = ${email} AND tu.is_active = true
    `;
  }

  resolvePermissionsForUser(userId: string) {
    return this.sql`
      SELECT trp.resource, trp.action
      FROM tenant_role_permissions trp
      JOIN tenant_users tu ON tu.role_id = trp.role_id
      WHERE tu.id = ${userId}
    `;
  }
}
