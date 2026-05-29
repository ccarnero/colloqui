import {
  MongoModule as BaseMongoModule,
  PLATFORM_MONGO_POOL_OPTIONS,
} from "@yoizen/database";
import { REGISTRY_MONGO_SCHEMA } from "@yoizen/shared";
import { registryServiceConfig } from "../config";

export { MONGO_CLIENT } from "@yoizen/database";

export const MongoModule = BaseMongoModule.register({
  defaultHost: registryServiceConfig.defaultMongoHost,
  ...PLATFORM_MONGO_POOL_OPTIONS,
  schema: REGISTRY_MONGO_SCHEMA,
});
