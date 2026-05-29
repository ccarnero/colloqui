import type { MongoClient } from "mongodb";
import { tenantServiceConfig } from "../config";

/** Returns the platform MongoDB database handle. */
export function platformDb(client: MongoClient) {
  return client.db(tenantServiceConfig.mongoDb);
}
