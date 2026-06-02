/** Tenant-scoped user accounts (`tenant_users`) in per-tenant MongoDB. */
import { Inject, Injectable } from "@nestjs/common";
import type { Db, TenantMongoConnectionManager } from "@yoizen/database";
import { AuthTenantConnectionManager } from "../../providers/auth-tenant-connection-manager";
import type {
  IInsertTenantUserOptions,
  ITenantUserListRow,
  ITenantUsersRepository,
} from "./tenant-users.repository.interface";

interface ITenantUserDoc {
  readonly _id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly role_id: string;
  readonly display_name: string | null;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface ITenantRoleDoc {
  readonly _id: string;
  readonly name: string;
}

@Injectable()
export class TenantUsersMongoRepository implements ITenantUsersRepository {
  constructor(
    @Inject(AuthTenantConnectionManager)
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  private async dbFor(tenantId: string): Promise<Db> {
    return this.tenantConnections.ensureSchema(tenantId);
  }

  async findByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<Array<{ id: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantUserDoc>("tenant_users")
      .findOne({ email }, { projection: { _id: 1 } });
    return doc ? [{ id: doc._id }] : [];
  }

  async insertUser(
    options: IInsertTenantUserOptions,
  ): Promise<
    Array<{
      id: string;
      email: string;
      role_id: string;
      display_name: string | null;
      created_at: Date;
      updated_at: Date;
    }>
  > {
    const { id, tenantId, email, passwordHash, roleId, displayName } = options;
    const db = await this.dbFor(tenantId);
    const now = new Date();
    const doc: ITenantUserDoc = {
      _id: id,
      email,
      password_hash: passwordHash,
      role_id: roleId,
      display_name: displayName,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    await db.collection<ITenantUserDoc>("tenant_users").insertOne(doc);
    return [
      {
        id,
        email,
        role_id: roleId,
        display_name: displayName,
        created_at: now,
        updated_at: now,
      },
    ];
  }

  async selectRoleName(
    tenantId: string,
    roleId: string,
  ): Promise<Array<{ name: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne({ _id: roleId }, { projection: { name: 1 } });
    return doc ? [{ name: doc.name }] : [];
  }

  async listByTenant(
    tenantId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      role_id: string;
      role: string;
      display_name: string | null;
      created_at: Date;
      updated_at: Date;
    }>
  > {
    const db = await this.dbFor(tenantId);
    const rows = await db
      .collection<ITenantUserDoc>("tenant_users")
      .aggregate<{
        id: string;
        email: string;
        role_id: string;
        role: string;
        display_name: string | null;
        created_at: Date;
        updated_at: Date;
      }>([
        { $match: { is_active: true } },
        {
          $lookup: {
            from: "tenant_roles",
            localField: "role_id",
            foreignField: "_id",
            as: "role_doc",
          },
        },
        { $unwind: "$role_doc" },
        {
          $project: {
            id: "$_id",
            email: 1,
            role_id: 1,
            role: "$role_doc.name",
            display_name: 1,
            created_at: 1,
            updated_at: 1,
          },
        },
        { $sort: { created_at: -1 } },
      ])
      .toArray();
    return rows;
  }

  async findActiveById(
    tenantId: string,
    id: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      role_id: string;
      role: string;
      display_name: string | null;
      created_at: Date;
      updated_at: Date;
    }>
  > {
    const db = await this.dbFor(tenantId);
    const rows = await db
      .collection<ITenantUserDoc>("tenant_users")
      .aggregate<{
        id: string;
        email: string;
        role_id: string;
        role: string;
        display_name: string | null;
        created_at: Date;
        updated_at: Date;
      }>([
        { $match: { _id: id, is_active: true } },
        {
          $lookup: {
            from: "tenant_roles",
            localField: "role_id",
            foreignField: "_id",
            as: "role_doc",
          },
        },
        { $unwind: "$role_doc" },
        {
          $project: {
            id: "$_id",
            email: 1,
            role_id: 1,
            role: "$role_doc.name",
            display_name: 1,
            created_at: 1,
            updated_at: 1,
          },
        },
        { $limit: 1 },
      ])
      .toArray();
    return rows;
  }

  async findByIdAny(
    tenantId: string,
    id: string,
  ): Promise<Array<{ id: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantUserDoc>("tenant_users")
      .findOne({ _id: id }, { projection: { _id: 1 } });
    return doc ? [{ id: doc._id }] : [];
  }

  async updateUser(
    tenantId: string,
    id: string,
    roleId: string | null,
    displayName: string | null,
    isActive: boolean | null,
  ): Promise<void> {
    const db = await this.dbFor(tenantId);
    const setFields: Record<string, unknown> = {
      updated_at: new Date(),
    };
    if (roleId !== null) {
      setFields.role_id = roleId;
    }
    if (displayName !== null) {
      setFields.display_name = displayName;
    }
    if (isActive !== null) {
      setFields.is_active = isActive;
    }
    await db
      .collection<ITenantUserDoc>("tenant_users")
      .updateOne({ _id: id }, { $set: setFields });
  }

  async findId(tenantId: string, id: string): Promise<Array<{ id: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantUserDoc>("tenant_users")
      .findOne({ _id: id }, { projection: { _id: 1 } });
    return doc ? [{ id: doc._id }] : [];
  }

  async deactivate(tenantId: string, id: string): Promise<void> {
    const db = await this.dbFor(tenantId);
    await db.collection<ITenantUserDoc>("tenant_users").updateOne(
      { _id: id },
      { $set: { is_active: false, updated_at: new Date() } },
    );
  }

  async resolveRoleById(
    roleIdOrName: string,
    tenantId: string,
  ): Promise<Array<{ id: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne(
        { _id: roleIdOrName, is_active: true },
        { projection: { _id: 1 } },
      );
    return doc ? [{ id: doc._id }] : [];
  }

  async resolveRoleByName(
    roleIdOrName: string,
    tenantId: string,
  ): Promise<Array<{ id: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne(
        { name: roleIdOrName, is_active: true },
        { projection: { _id: 1 } },
      );
    return doc ? [{ id: doc._id }] : [];
  }
}
