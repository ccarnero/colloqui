import {
  MongoModule as BaseMongoModule,
  PLATFORM_MONGO_POOL_OPTIONS,
} from "@yoizen/database";
import { PLATFORM_MONGO_SCHEMA } from "@yoizen/shared";
import { channelServiceConfig } from "../config";

export { MONGO_CLIENT } from "@yoizen/database";

export const MongoModule = BaseMongoModule.register({
  defaultHost: channelServiceConfig.defaultMongoHost,
  ...PLATFORM_MONGO_POOL_OPTIONS,
  schema: PLATFORM_MONGO_SCHEMA,
});
