import { PLATFORM_MONGO_SCHEMA } from "./platform-mongo-schema";
import type { IMongoCollectionSchema } from "./mongo-schema.types";

const REGISTRY_COLLECTION_NAMES = new Set([
  "registered_services",
  "service_routes",
  "canary_deployments",
]);

/** Platform Mongo subset used by registry-service only. */
export const REGISTRY_MONGO_SCHEMA: IMongoCollectionSchema[] =
  PLATFORM_MONGO_SCHEMA.filter((entry) =>
    REGISTRY_COLLECTION_NAMES.has(entry.collection),
  );
