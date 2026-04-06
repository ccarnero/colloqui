import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { authServiceConfig } from "../../config";
import { hashSecret } from "../../utils/password";
import { TenantRolesService } from "../tenant-roles/tenant-roles.service";
import { TenantUsersRepository } from "./tenant-users.repository";

interface ITenantUserRow {
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

type TenantUserPublic = Omit<ITenantUserRow, "is_active">;

/** Columns returned by {@link TenantUsersRepository.insertUser}. */
interface ITenantUserInsertRow {
  id: string;
  tenant_id: string;
  email: string;
  role_id: string;
  display_name: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ICreateTenantUserOptions {
  tenantId: string;
  email: string;
  password: string;
  roleId: string;
  displayName?: string;
}

@Injectable()
export class TenantUsersService implements OnModuleInit {
  private readonly logger = new PinoLoggerService(TenantUsersService.name);

  constructor(
    private readonly tenantUsersRepository: TenantUsersRepository,
    private readonly tenantRolesService: TenantRolesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedTenantAdmin();
  }

  async create(options: ICreateTenantUserOptions): Promise<TenantUserPublic> {
    const { tenantId, email, password, displayName } = options;
    let { roleId } = options;
    await this.tenantRolesService.seedSystemRole(tenantId);
    roleId = await this.resolveRoleId(roleId, tenantId);

    const existing = await this.tenantUsersRepository.findByTenantAndEmail(
      tenantId,
      email,
    );
    if (existing.length > 0) {
      throw new ConflictException(
        `User with email '${email}' already exists for this tenant`,
      );
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashSecret(password);

    const rows = await this.tenantUsersRepository.insertUser({
      id,
      tenantId,
      email,
      passwordHash,
      roleId,
      displayName: displayName ?? null,
    });

    const row = rows[0] as ITenantUserInsertRow;
    const roleRows = await this.tenantUsersRepository.selectRoleName(roleId);
    const roleName =
      (roleRows[0] as { name: string } | undefined)?.name ?? "";

    this.logger.log(
      `Created tenant user ${email} (role_id=${roleId}) for tenant ${tenantId}`,
    );

    return {
      id: row.id,
      tenant_id: row.tenant_id,
      email: row.email,
      role_id: row.role_id,
      role: roleName,
      display_name: row.display_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async listByTenant(tenantId: string): Promise<TenantUserPublic[]> {
    const rows = await this.tenantUsersRepository.listByTenant(tenantId);
    return rows as unknown as TenantUserPublic[];
  }

  async findById(id: string): Promise<TenantUserPublic> {
    const rows = await this.tenantUsersRepository.findActiveById(id);
    if (rows.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }
    return rows[0] as TenantUserPublic;
  }

  async update(
    id: string,
    updates: {
      role_id?: string;
      display_name?: string;
      is_active?: boolean;
    },
  ): Promise<TenantUserPublic> {
    const existing = await this.tenantUsersRepository.findByIdAny(id);
    if (existing.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }

    let resolvedRoleId: string | null = updates.role_id ?? null;
    if (updates.role_id) {
      resolvedRoleId = await this.resolveRoleId(
        updates.role_id,
        (existing[0] as { tenant_id: string }).tenant_id,
      );
    }

    await this.tenantUsersRepository.updateUser(
      id,
      resolvedRoleId,
      updates.display_name ?? null,
      updates.is_active ?? null,
    );

    this.logger.log(`Updated tenant user ${id}`);
    return this.findById(id);
  }

  async deactivate(id: string): Promise<void> {
    const existing = await this.tenantUsersRepository.findId(id);
    if (existing.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }

    await this.tenantUsersRepository.deactivate(id);
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
    const byId = await this.tenantUsersRepository.resolveRoleById(
      roleIdOrName,
      tenantId,
    );
    if (byId.length > 0) return (byId[0] as { id: string }).id;

    const byName = await this.tenantUsersRepository.resolveRoleByName(
      roleIdOrName,
      tenantId,
    );
    if (byName.length > 0) return (byName[0] as { id: string }).id;

    throw new BadRequestException(
      `Role '${roleIdOrName}' does not exist or does not belong to this tenant`,
    );
  }

  private async seedTenantAdmin(): Promise<void> {
    const tenantId = authServiceConfig.tenantAdminTenantId;
    const email = authServiceConfig.tenantAdminEmail;
    const password = authServiceConfig.tenantAdminPassword;
    const displayName = authServiceConfig.tenantAdminDisplayName;

    if (!tenantId || !email || !password) {
      return;
    }

    const existing = await this.tenantUsersRepository.findByTenantAndEmail(
      tenantId,
      email,
    );

    if (existing.length > 0) {
      return;
    }

    const systemRoleId = await this.tenantRolesService.seedSystemRole(tenantId);

    await this.create({
      tenantId,
      email,
      password,
      roleId: systemRoleId,
      displayName,
    });

    this.logger.log(`Seeded tenant admin user: ${email} (${tenantId})`);
  }
}
