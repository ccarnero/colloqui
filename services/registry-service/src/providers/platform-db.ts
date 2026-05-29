import type { Db, MongoClient } from "@yoizen/database";
import { registryServiceConfig } from "../config";

/** Resolves the platform MongoDB database handle from a shared client. */
export function platformDb(client: MongoClient): Db {
  return client.db(registryServiceConfig.mongoDatabase);
}
