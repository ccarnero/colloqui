import { platformServiceUrl } from "@yoizen/shared";

const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

type ChannelServiceConfig = {
  readonly port: number;
  readonly channelServicePublicUrl: string;
  /** Default Postgres host for shared schema (support-services cluster). */
  readonly defaultPostgresHost: string;
};

export const channelServiceConfig: ChannelServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  // Phase 1.5: webhook callbacks land on the HTTP-bound `*-api` pod.
  channelServicePublicUrl:
    process.env.CHANNEL_SERVICE_PUBLIC_URL ??
    platformServiceUrl("channel-service-api", env),
  defaultPostgresHost:
    process.env.POSTGRES_HOST ??
    "postgres.support-services-dev.svc.cluster.local",
};
