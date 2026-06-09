type AgentMemoryServiceConfig = {
  readonly port: number;
  readonly natsUrl: string;
};

export const agentMemoryServiceConfig: AgentMemoryServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get natsUrl() {
    return process.env.NATS_URL ?? "nats://localhost:4222";
  },
};
