import Redis from "ioredis";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { agentSchedulerServiceConfig } from "../config";

export const REDIS_CLIENT = "REDIS_CLIENT";

@Injectable()
export class RedisProvider implements OnModuleDestroy {
  private readonly logger = new PinoLoggerService(RedisProvider.name);
  readonly client: Redis;

  constructor() {
    this.client = new Redis(agentSchedulerServiceConfig.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    this.client.on("error", (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async connect(): Promise<void> {
    if (this.client.status !== "ready" && this.client.status !== "connect") {
      await this.client.connect();
      this.logger.log("Redis connection established");
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

export const redisProvider = {
  provide: REDIS_CLIENT,
  useFactory: () => new RedisProvider(),
};
