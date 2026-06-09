type AgentSchedulerServiceConfig = {
  readonly port: number;
  readonly platformEnvironment: string;
  readonly natsUrl: string;
  readonly redisUrl: string;
  readonly reconcileIntervalMs: number;
  readonly adminApiKey: string | undefined;
  readonly leaderElectionPostgresUrl: string | undefined;
};

export const agentSchedulerServiceConfig: AgentSchedulerServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get platformEnvironment() {
    return process.env.PLATFORM_ENVIRONMENT ?? "dev";
  },
  get natsUrl() {
    return process.env.NATS_URL ?? "nats://localhost:4222";
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get reconcileIntervalMs() {
    return Number.parseInt(
      process.env.RECONCILE_INTERVAL_MS ?? "30000",
      10,
    );
  },
  get adminApiKey() {
    const key = process.env.ADMIN_API_KEY;
    return key && key.length > 0 ? key : undefined;
  },
  get leaderElectionPostgresUrl() {
    const url = process.env.LEADER_ELECTION_POSTGRES_URL;
    return url && url.length > 0 ? url : undefined;
  },
};
