import type { DynamicModule } from "@nestjs/common";
import {
  MongoModule,
  MONGO_CLIENT,
  PLATFORM_MONGO_POOL_OPTIONS,
} from "@yoizen/database";
import { PLATFORM_MONGO_SCHEMA } from "@yoizen/shared";

export { MONGO_CLIENT };

/** Platform tenants catalog — subset of {@link PLATFORM_MONGO_SCHEMA}. */
export const TENANTS_PLATFORM_MONGO_SCHEMA = PLATFORM_MONGO_SCHEMA.filter(
  (descriptor) => descriptor.collection === "tenants",
);

export const PlatformMongoModule: DynamicModule = MongoModule.register({
  defaultHost: process.env.MONGO_HOST ?? "mongo-platform.support-services-dev.svc.cluster.local",
  ...PLATFORM_MONGO_POOL_OPTIONS,
  schema: TENANTS_PLATFORM_MONGO_SCHEMA,
});
