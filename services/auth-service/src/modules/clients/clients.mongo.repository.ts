/** CRUD helpers for `api_clients` — MongoDB. */
import { Inject, Injectable } from "@nestjs/common";
import type { MongoClient } from "@yoizen/database";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { platformDb } from "../../providers/platform-db";
import type {
  IClientRow,
  IClientsRepository,
  IInsertClientOptions,
} from "./clients.repository.interface";

interface IApiClientDoc {
  readonly _id: string;
  readonly client_id: string;
  readonly client_secret_hash: string;
  readonly name: string;
  readonly scope: string;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

@Injectable()
export class ClientsMongoRepository implements IClientsRepository {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async insertClient(options: IInsertClientOptions): Promise<IClientRow[]> {
    const { id, clientId, secretHash, name, scope } = options;
    const now = new Date();
    const doc: IApiClientDoc = {
      _id: id,
      client_id: clientId,
      client_secret_hash: secretHash,
      name,
      scope,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    await platformDb(this.client)
      .collection<IApiClientDoc>("api_clients")
      .insertOne(doc);
    return [
      {
        id,
        client_id: clientId,
        name,
        scope,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ];
  }

  async listForTenant(
    tenantScope: string,
  ): Promise<Omit<IClientRow, "is_active">[]> {
    const docs = await platformDb(this.client)
      .collection<IApiClientDoc>("api_clients")
      .find({
        is_active: true,
        scope: { $in: ["platform", tenantScope] },
      })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map((doc) => ({
      id: doc._id,
      client_id: doc.client_id,
      name: doc.name,
      scope: doc.scope,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    }));
  }

  async listAllActive(): Promise<Omit<IClientRow, "is_active">[]> {
    const docs = await platformDb(this.client)
      .collection<IApiClientDoc>("api_clients")
      .find({ is_active: true })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map((doc) => ({
      id: doc._id,
      client_id: doc.client_id,
      name: doc.name,
      scope: doc.scope,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    }));
  }

  async revokeClient(id: string): Promise<boolean> {
    const result = await platformDb(this.client)
      .collection<IApiClientDoc>("api_clients")
      .updateOne(
        { _id: id, is_active: true },
        { $set: { is_active: false, updated_at: new Date() } },
      );
    return result.matchedCount > 0;
  }
}
