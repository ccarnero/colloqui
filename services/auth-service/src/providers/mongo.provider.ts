import type { DynamicModule } from "@nestjs/common";
import {
  MongoModule,
  MONGO_CLIENT,
  PLATFORM_MONGO_POOL_OPTIONS,
} from "@yoizen/database";
import { PLATFORM_MONGO_SCHEMA } from "@yoizen/shared";

export { MONGO_CLIENT };

export const AuthMongoModule: DynamicModule = MongoModule.register({
  ...PLATFORM_MONGO_POOL_OPTIONS,
  schema: PLATFORM_MONGO_SCHEMA,
});
