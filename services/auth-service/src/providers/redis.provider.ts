import type { FactoryProvider } from "@nestjs/common";
import { createRedisProvider } from "@yoizen/database";

export { REDIS_CLIENT } from "@yoizen/database";

export const redisProvider: FactoryProvider = createRedisProvider();
