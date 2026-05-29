import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";
import { platformServiceUrl } from "@yoizen/shared";

const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

type ChannelServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
  readonly channelServicePublicUrl: string;
  readonly defaultPostgresHost: string;
  readonly defaultMongoHost: string;
  readonly mongoDatabase: string;
};

/** Lazy getters so tests can set `process.env` before first consumer reads config. */
export const channelServiceConfig: ChannelServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
  get channelServicePublicUrl() {
    return (
      process.env.CHANNEL_SERVICE_PUBLIC_URL ??
      platformServiceUrl("channel-service-api", env)
    );
  },
  get defaultPostgresHost() {
    return (
      process.env.POSTGRES_HOST ??
      `postgres.support-services-${env}.svc.cluster.local`
    );
  },
  get defaultMongoHost() {
    return (
      process.env.MONGO_HOST ??
      `mongo-platform.support-services-${env}.svc.cluster.local`
    );
  },
  get mongoDatabase() {
    return process.env.MONGO_DB ?? "yoizen";
  },
};
