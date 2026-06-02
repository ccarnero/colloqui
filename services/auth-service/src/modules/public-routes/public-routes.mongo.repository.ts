/**
 * Persistence layer for `public_routes` and Redis sync queries — MongoDB.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { MongoClient } from "@yoizen/database";
import { authServiceConfig } from "../../config";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { platformDb } from "../../providers/platform-db";
import type {
  IPublicRouteRow,
  IPublicRoutesRepository,
} from "./public-routes.repository.interface";

interface IPublicRouteDoc {
  readonly _id: string;
  readonly method: string;
  readonly path_pattern: string;
  readonly scope: string;
  readonly environment: string;
  readonly created_at: Date;
}

@Injectable()
export class PublicRoutesMongoRepository implements IPublicRoutesRepository {
  readonly environmentName: string;

  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {
    this.environmentName = authServiceConfig.platformEnvironment;
  }

  async insertRoute(
    id: string,
    method: string,
    pathPattern: string,
    scope: string,
  ): Promise<IPublicRouteRow[]> {
    const now = new Date();
    const doc: IPublicRouteDoc = {
      _id: id,
      method,
      path_pattern: pathPattern,
      scope,
      environment: this.environmentName,
      created_at: now,
    };
    await platformDb(this.client)
      .collection<IPublicRouteDoc>("public_routes")
      .insertOne(doc);
    return [
      {
        id,
        method,
        path_pattern: pathPattern,
        scope,
        environment: this.environmentName,
        created_at: now,
      },
    ];
  }

  async listForTenant(tenantScope: string): Promise<IPublicRouteRow[]> {
    const docs = await platformDb(this.client)
      .collection<IPublicRouteDoc>("public_routes")
      .find({
        environment: this.environmentName,
        scope: { $in: ["platform", tenantScope] },
      })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map((doc) => ({
      id: doc._id,
      method: doc.method,
      path_pattern: doc.path_pattern,
      scope: doc.scope,
      environment: doc.environment,
      created_at: doc.created_at,
    }));
  }

  async listAll(): Promise<IPublicRouteRow[]> {
    const docs = await platformDb(this.client)
      .collection<IPublicRouteDoc>("public_routes")
      .find({ environment: this.environmentName })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map((doc) => ({
      id: doc._id,
      method: doc.method,
      path_pattern: doc.path_pattern,
      scope: doc.scope,
      environment: doc.environment,
      created_at: doc.created_at,
    }));
  }

  async deleteById(id: string): Promise<{ id: string }[]> {
    const result = await platformDb(this.client)
      .collection<IPublicRouteDoc>("public_routes")
      .deleteOne({ _id: id, environment: this.environmentName });
    return result.deletedCount > 0 ? [{ id }] : [];
  }

  async loadSyncRows(): Promise<
    Array<{ method: unknown; path_pattern: unknown; scope: unknown }>
  > {
    const docs = await platformDb(this.client)
      .collection<IPublicRouteDoc>("public_routes")
      .find(
        { environment: this.environmentName },
        { projection: { method: 1, path_pattern: 1, scope: 1 } },
      )
      .toArray();
    return docs.map((doc) => ({
      method: doc.method,
      path_pattern: doc.path_pattern,
      scope: doc.scope,
    }));
  }
}
