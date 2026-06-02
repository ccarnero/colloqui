/** Platform user persistence (`platform_users`) — MongoDB. */
import { Inject, Injectable } from "@nestjs/common";
import type { MongoClient } from "@yoizen/database";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { platformDb } from "../../providers/platform-db";
import type {
  IInsertUserParams,
  IUsersRepository,
  IUserRow,
} from "./users.repository.interface";

interface IPlatformUserDoc {
  readonly _id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly role: string;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

@Injectable()
export class UsersMongoRepository implements IUsersRepository {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async findByEmail(email: string): Promise<Array<{ id: string }>> {
    const doc = await platformDb(this.client)
      .collection<IPlatformUserDoc>("platform_users")
      .findOne({ email }, { projection: { _id: 1 } });
    return doc ? [{ id: doc._id }] : [];
  }

  async insertUser(
    params: IInsertUserParams,
  ): Promise<Omit<IUserRow, "is_active">[]> {
    const { id, email, passwordHash, role } = params;
    const now = new Date();
    const doc: IPlatformUserDoc = {
      _id: id,
      email,
      password_hash: passwordHash,
      role,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    await platformDb(this.client)
      .collection<IPlatformUserDoc>("platform_users")
      .insertOne(doc);
    return [
      {
        id,
        email,
        role,
        created_at: now,
        updated_at: now,
      },
    ];
  }

  async listActive(): Promise<Omit<IUserRow, "is_active">[]> {
    const docs = await platformDb(this.client)
      .collection<IPlatformUserDoc>("platform_users")
      .find({ is_active: true })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map((doc) => ({
      id: doc._id,
      email: doc.email,
      role: doc.role,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    }));
  }

  async findAdmin(): Promise<Array<{ id: string }>> {
    const doc = await platformDb(this.client)
      .collection<IPlatformUserDoc>("platform_users")
      .findOne({ role: "admin" }, { projection: { _id: 1 } });
    return doc ? [{ id: doc._id }] : [];
  }
}
