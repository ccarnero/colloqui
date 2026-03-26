import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";
import { TenantRolesService } from "../tenant-roles/tenant-roles.service";

export interface TenantUserRow {
  id: string;
  tenant_id: string;
  email: string;
  role_id: string;
  role: string;
  display_name: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

type TenantUserPublic = Omit<TenantUserRow, "is_active">;

@Injectable()
export class TenantUsersService {
  private readonly logger = new Logger(TenantUsersService.name);

  constructor(
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
    private readonly tenantRolesService: TenantRolesService,
  ) {}

  async create(
    tenantId: string,
    email: string,
    password: string,
    roleId: string,
    displayName?: string,
  ): Promise<TenantUserPublic> {
    await this.tenantRolesService.seedSystemRole(tenantId);
    roleId = await this.resolveRoleId(roleId, tenantId);

    const existing = await this.sql`
      SELECT id FROM tenant_users
      WHERE tenant_id = ${tenantId} AND email = ${email}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new ConflictException(
        `User with email '${email}' already exists for this tenant`,
      );
    }

    const id = crypto.randomUUID();
    const passwordHash = await Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 19_456,
      timeCost: 2,
    });

    const rows = await this.sql`
      INSERT INTO tenant_users (id, tenant_id, email, password_hash, role_id, display_name)
      VALUES (${id}, ${tenantId}, ${email}, ${passwordHash}, ${roleId}, ${displayName ?? null})
      RETURNING id, tenant_id, email, role_id, display_name, created_at, updated_at
    `;

    const user = rows[0];
    const role = await this.sql`
      SELECT name FROM tenant_roles WHERE id = ${roleId} LIMIT 1
    `;

    this.logger.log(
      `Created tenant user ${email} (role_id=${roleId}) for tenant ${tenantId}`,
    );

    return {
      ...user,
      role: role[0]?.name ?? "",
    } as unknown as TenantUserPublic;
  }

  async listByTenant(tenantId: string): Promise<TenantUserPublic[]> {
    const rows = await this.sql`
      SELECT tu.id, tu.tenant_id, tu.email, tu.role_id,
             tr.name AS role, tu.display_name,
             tu.created_at, tu.updated_at
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.tenant_id = ${tenantId} AND tu.is_active = true
      ORDER BY tu.created_at DESC
    `;
    return rows as unknown as TenantUserPublic[];
  }

  async findById(id: string): Promise<TenantUserPublic> {
    const rows = await this.sql`
      SELECT tu.id, tu.tenant_id, tu.email, tu.role_id,
             tr.name AS role, tu.display_name,
             tu.created_at, tu.updated_at
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.id = ${id} AND tu.is_active = true
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }
    return rows[0] as unknown as TenantUserPublic;
  }

  async update(
    id: string,
    updates: {
      role_id?: string;
      display_name?: string;
      is_active?: boolean;
    },
  ): Promise<TenantUserPublic> {
    const existing = await this.sql`
      SELECT id, tenant_id FROM tenant_users WHERE id = ${id} LIMIT 1
    `;
    if (existing.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }

    if (updates.role_id) {
      updates.role_id = await this.resolveRoleId(
        updates.role_id,
        existing[0].tenant_id as string,
      );
    }

    await this.sql`
      UPDATE tenant_users SET
        role_id = COALESCE(${updates.role_id ?? null}, role_id),
        display_name = COALESCE(${updates.display_name ?? null}, display_name),
        is_active = COALESCE(${updates.is_active ?? null}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
    `;

    this.logger.log(`Updated tenant user ${id}`);
    return this.findById(id);
  }

  async deactivate(id: string): Promise<void> {
    const existing = await this.sql`
      SELECT id FROM tenant_users WHERE id = ${id} LIMIT 1
    `;
    if (existing.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }

    await this.sql`
      UPDATE tenant_users SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;
    this.logger.log(`Deactivated tenant user ${id}`);
  }

  /**
   * Accepts either a role UUID or a role name and returns the UUID.
   * Looks up by ID first, then falls back to name within the tenant.
   */
  private async resolveRoleId(
    roleIdOrName: string,
    tenantId: string,
  ): Promise<string> {
    const byId = await this.sql`
      SELECT id FROM tenant_roles
      WHERE id = ${roleIdOrName}
        AND tenant_id = ${tenantId}
        AND is_active = true
      LIMIT 1
    `;
    if (byId.length > 0) return byId[0].id as string;

    const byName = await this.sql`
      SELECT id FROM tenant_roles
      WHERE name = ${roleIdOrName}
        AND tenant_id = ${tenantId}
        AND is_active = true
      LIMIT 1
    `;
    if (byName.length > 0) return byName[0].id as string;

    throw new BadRequestException(
      `Role '${roleIdOrName}' does not exist or does not belong to this tenant`,
    );
  }
}
