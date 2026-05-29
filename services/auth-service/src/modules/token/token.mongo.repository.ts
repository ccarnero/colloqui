/**
 * Mongo access for OAuth/token flows: platform `api_clients` / `platform_users`,
 * per-tenant `tenant_users` / `tenant_roles` / `tenant_role_permissions`.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { TenantMongoConnectionManager } from "@yoizen/database";
import type { ITokenRepository } from "./token.repository.interface";
import type { Db, MongoClient } from "@yoizen/database";
import { AuthTenantConnectionManager } from "../../providers/auth-tenant-connection-manager";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { platformDb } from "../../providers/platform-db";

interface IApiClientDoc {
  readonly _id: string;
  readonly client_secret_hash: string;
  readonly scope: string;
  readonly is_active: boolean;
}

interface IPlatformUserDoc {
  readonly _id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly role: string;
  readonly is_active: boolean;
}

interface ITenantCatalogDoc {
  readonly name: string;
}

interface ITenantUserAuthDoc {
  readonly _id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly is_active: boolean;
  readonly role_id: string;
}

interface ITenantRoleAuthDoc {
  readonly _id: string;
  readonly name: string;
  readonly is_system: boolean;
}

@Injectable()
export class TokenMongoRepository implements ITokenRepository {
  constructor(
    @Inject(MONGO_CLIENT) private readonly platformClient: MongoClient,
    @Inject(AuthTenantConnectionManager)
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  private async dbFor(tenantId: string): Promise<Db> {
    return this.tenantConnections.ensureSchema(tenantId);
  }

  async findClientByClientId(clientId: string): Promise<
    Array<{
      id: string;
      client_secret_hash: string;
      scope: string;
      is_active: boolean;
    }>
  > {
    const doc = await platformDb(this.platformClient)
      .collection<IApiClientDoc>("api_clients")
      .findOne({ client_id: clientId });
    return doc
      ? [
          {
            id: doc._id,
            client_secret_hash: doc.client_secret_hash,
            scope: doc.scope,
            is_active: doc.is_active,
          },
        ]
      : [];
  }

  async findPlatformUserById(userId: string): Promise<
    Array<{
      id: string;
      email: string;
      role: string;
      is_active: boolean;
    }>
  > {
    const doc = await platformDb(this.platformClient)
      .collection<IPlatformUserDoc>("platform_users")
      .findOne({ _id: userId });
    return doc
      ? [
          {
            id: doc._id,
            email: doc.email,
            role: doc.role,
            is_active: doc.is_active,
          },
        ]
      : [];
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
    const db = await this.dbFor(tenantId);
    const rows = await db
      .collection<ITenantUserAuthDoc>("tenant_users")
      .aggregate<{
        id: string;
        email: string;
        is_active: boolean;
        role_name: string;
        is_system: boolean;
      }>([
        { $match: { _id: userId } },
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
            is_active: 1,
            role_name: "$role_doc.name",
            is_system: "$role_doc.is_system",
          },
        },
        { $limit: 1 },
      ])
      .toArray();
    return rows;
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
    const doc = await platformDb(this.platformClient)
      .collection<IPlatformUserDoc>("platform_users")
      .findOne({ email });
    return doc
      ? [
          {
            id: doc._id,
            email: doc.email,
            password_hash: doc.password_hash,
            role: doc.role,
            is_active: doc.is_active,
          },
        ]
      : [];
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
    const db = await this.dbFor(tenantId);
    const rows = await db
      .collection<ITenantUserAuthDoc>("tenant_users")
      .aggregate<{
        id: string;
        email: string;
        password_hash: string;
        role_name: string;
        is_system: boolean;
      }>([
        { $match: { email, is_active: true } },
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
            password_hash: 1,
            role_name: "$role_doc.name",
            is_system: "$role_doc.is_system",
          },
        },
        { $limit: 1 },
      ])
      .toArray();
    return rows;
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
    const tenantRows = await platformDb(this.platformClient)
      .collection<ITenantCatalogDoc>("tenants")
      .find({ provisioning_status: "ready" })
      .sort({ name: 1 })
      .project({ name: 1 })
      .toArray();

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
        const db = await this.dbFor(tenantName);
        const rows = await db
          .collection<ITenantUserAuthDoc>("tenant_users")
          .aggregate<{
            id: string;
            email: string;
            password_hash: string;
            role_name: string;
            is_system: boolean;
          }>([
            { $match: { email, is_active: true } },
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
                password_hash: 1,
                role_name: "$role_doc.name",
                is_system: "$role_doc.is_system",
              },
            },
            { $limit: 1 },
          ])
          .toArray();
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
    const db = await this.dbFor(tenantId);
    const user = await db
      .collection<ITenantUserAuthDoc>("tenant_users")
      .findOne({ _id: userId }, { projection: { role_id: 1 } });
    if (!user) {
      return [];
    }
    const docs = await db
      .collection<{ resource: string; action: string }>(
        "tenant_role_permissions",
      )
      .find({ role_id: user.role_id })
      .toArray();
    return docs.map((doc) => ({
      resource: doc.resource,
      action: doc.action,
    }));
  }
}
