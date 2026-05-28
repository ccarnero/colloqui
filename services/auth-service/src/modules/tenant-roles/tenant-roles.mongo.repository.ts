/** Tenant roles and permission rows in per-tenant MongoDB. */
import { Inject, Injectable } from "@nestjs/common";
import type { ClientSession, Db, TenantMongoConnectionManager } from "@yoizen/database";
import { AuthTenantConnectionManager } from "../../providers/auth-tenant-connection-manager";
import { SYSTEM_ROLE_TENANT_ADMIN } from "@yoizen/shared";
import type { PermissionDto } from "./tenant-role.dto";
import type {
  ICreateRoleWithPermissionsOptions,
  ITenantRoleRow,
  ITenantRolesRepository,
} from "./tenant-roles.repository.interface";


interface ITenantRoleDoc {
  readonly _id: string;
  readonly name: string;
  readonly description: string | null;
  readonly is_system: boolean;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface ITenantRolePermissionDoc {
  readonly _id: string;
  readonly role_id: string;
  readonly resource: string;
  readonly action: string;
}

@Injectable()
export class TenantRolesMongoRepository implements ITenantRolesRepository {
  constructor(
    @Inject(AuthTenantConnectionManager)
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  private async dbFor(tenantId: string): Promise<Db> {
    return this.tenantConnections.ensureSchema(tenantId);
  }

  async findSystemRoleId(tenantId: string): Promise<Array<{ id: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne({ name: SYSTEM_ROLE_TENANT_ADMIN }, { projection: { _id: 1 } });
    return doc ? [{ id: doc._id }] : [];
  }

  async insertSystemRoleOnConflict(
    id: string,
    tenantId: string,
  ): Promise<void> {
    const db = await this.dbFor(tenantId);
    const now = new Date();
    await db.collection<ITenantRoleDoc>("tenant_roles").updateOne(
      { name: SYSTEM_ROLE_TENANT_ADMIN },
      {
        $setOnInsert: {
          _id: id,
          name: SYSTEM_ROLE_TENANT_ADMIN,
          description: "Full administrative access — bypasses all permission checks",
          is_system: true,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    );
  }

  async findRoleByTenantAndName(
    tenantId: string,
    name: string,
  ): Promise<Array<{ id: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne({ name }, { projection: { _id: 1 } });
    return doc ? [{ id: doc._id }] : [];
  }

  async createRoleWithPermissions(
    options: ICreateRoleWithPermissionsOptions,
  ): Promise<void> {
    const { id, tenantId, name, description, permissions } = options;
    const db = await this.dbFor(tenantId);
    const session = db.client.startSession();
    try {
      await session.withTransaction(async () => {
        const now = new Date();
        await db.collection<ITenantRoleDoc>("tenant_roles").insertOne(
          {
            _id: id,
            name,
            description,
            is_system: false,
            is_active: true,
            created_at: now,
            updated_at: now,
          },
          { session },
        );

        if (permissions.length > 0) {
          const permDocs: ITenantRolePermissionDoc[] = permissions.map((p) => ({
            _id: crypto.randomUUID(),
            role_id: id,
            resource: p.resource,
            action: p.action,
          }));
          await db
            .collection<ITenantRolePermissionDoc>("tenant_role_permissions")
            .insertMany(permDocs, { session });
        }
      });
    } finally {
      await session.endSession();
    }
  }

  async listSummariesByTenant(
    tenantId: string,
  ): Promise<
    Array<
      ITenantRoleRow & {
        user_count: number;
      }
    >
  > {
    const db = await this.dbFor(tenantId);
    const rows = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .aggregate<{
        id: string;
        name: string;
        description: string | null;
        is_system: boolean;
        is_active: boolean;
        created_at: Date;
        updated_at: Date;
        user_count: number;
      }>([
        { $match: { is_active: true } },
        {
          $lookup: {
            from: "tenant_users",
            localField: "_id",
            foreignField: "role_id",
            as: "users",
          },
        },
        {
          $addFields: {
            user_count: {
              $size: {
                $filter: {
                  input: "$users",
                  as: "user",
                  cond: { $eq: ["$$user.is_active", true] },
                },
              },
            },
          },
        },
        {
          $project: {
            id: "$_id",
            name: 1,
            description: 1,
            is_system: 1,
            is_active: 1,
            created_at: 1,
            updated_at: 1,
            user_count: 1,
          },
        },
        { $sort: { is_system: -1, name: 1 } },
      ])
      .toArray();
    return rows;
  }

  async findActiveRoleBase(
    tenantId: string,
    id: string,
  ): Promise<ITenantRoleRow[]> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne({ _id: id, is_active: true });
    return doc ? [this.toRoleRow(doc)] : [];
  }

  async listPermissionsForRole(
    tenantId: string,
    roleId: string,
  ): Promise<Array<{ resource: string; action: string }>> {
    const db = await this.dbFor(tenantId);
    const docs = await db
      .collection<ITenantRolePermissionDoc>("tenant_role_permissions")
      .find({ role_id: roleId })
      .sort({ resource: 1, action: 1 })
      .toArray();
    return docs.map((doc) => ({
      resource: doc.resource,
      action: doc.action,
    }));
  }

  async findRoleForUpdate(
    tenantId: string,
    id: string,
  ): Promise<Array<{ id: string; is_system: boolean; name: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne(
        { _id: id, is_active: true },
        { projection: { _id: 1, is_system: 1, name: 1 } },
      );
    return doc
      ? [{ id: doc._id, is_system: doc.is_system, name: doc.name }]
      : [];
  }

  async findDuplicateName(
    tenantId: string,
    name: string,
    excludeId: string,
  ): Promise<Array<{ id: string }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne({ name, _id: { $ne: excludeId } }, { projection: { _id: 1 } });
    return doc ? [{ id: doc._id }] : [];
  }

  async updateRoleTransaction(
    tenantId: string,
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: PermissionDto[];
    },
  ): Promise<void> {
    const db = await this.dbFor(tenantId);
    const session = db.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.applyRolePatch(db, id, patch, session);
      });
    } finally {
      await session.endSession();
    }
  }

  private async applyRolePatch(
    db: Db,
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: PermissionDto[];
    },
    session: ClientSession,
  ): Promise<void> {
    const setFields: Record<string, unknown> = {
      updated_at: new Date(),
    };
    if (patch.name !== undefined) {
      setFields.name = patch.name;
    }
    if (patch.description !== undefined) {
      setFields.description = patch.description;
    }
    if (Object.keys(setFields).length > 1) {
      await db
        .collection<ITenantRoleDoc>("tenant_roles")
        .updateOne({ _id: id }, { $set: setFields }, { session });
    }

    if (patch.permissions === undefined) {
      return;
    }

    await db
      .collection<ITenantRolePermissionDoc>("tenant_role_permissions")
      .deleteMany({ role_id: id }, { session });

    if (patch.permissions.length === 0) {
      return;
    }

    const permDocs: ITenantRolePermissionDoc[] = patch.permissions.map((p) => ({
      _id: crypto.randomUUID(),
      role_id: id,
      resource: p.resource,
      action: p.action,
    }));
    await db
      .collection<ITenantRolePermissionDoc>("tenant_role_permissions")
      .insertMany(permDocs, { session });
  }

  async findForDelete(
    tenantId: string,
    id: string,
  ): Promise<Array<{ id: string; is_system: boolean }>> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<ITenantRoleDoc>("tenant_roles")
      .findOne(
        { _id: id, is_active: true },
        { projection: { _id: 1, is_system: 1 } },
      );
    return doc ? [{ id: doc._id, is_system: doc.is_system }] : [];
  }

  async hasActiveUsersForRole(
    tenantId: string,
    roleId: string,
  ): Promise<boolean> {
    const db = await this.dbFor(tenantId);
    const doc = await db.collection("tenant_users").findOne(
      { role_id: roleId, is_active: true },
      { projection: { _id: 1 } },
    );
    return doc !== null;
  }

  async softDeleteRole(tenantId: string, id: string): Promise<void> {
    const db = await this.dbFor(tenantId);
    await db.collection<ITenantRoleDoc>("tenant_roles").updateOne(
      { _id: id },
      { $set: { is_active: false, updated_at: new Date() } },
    );
  }

  private toRoleRow(doc: ITenantRoleDoc): ITenantRoleRow {
    return {
      id: doc._id,
      name: doc.name,
      description: doc.description,
      is_system: doc.is_system,
      is_active: doc.is_active,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    };
  }
}
