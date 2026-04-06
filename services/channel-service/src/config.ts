import { DEFAULT_CHANNEL_SERVICE_URL } from "@yoizen/shared";

type ChannelServiceConfig = {
  readonly port: number;
  readonly channelServicePublicUrl: string;
  /** Default Postgres host for shared schema (support-services cluster). */
  readonly defaultPostgresHost: string;
};

export const channelServiceConfig: ChannelServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  channelServicePublicUrl:
    process.env.CHANNEL_SERVICE_PUBLIC_URL ?? DEFAULT_CHANNEL_SERVICE_URL,
  defaultPostgresHost:
    process.env.POSTGRES_HOST ??
    "postgres.support-services-dev.svc.cluster.local",
};
