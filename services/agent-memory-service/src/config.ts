type AgentMemoryServiceConfig = {
  readonly port: number;
  readonly natsUrl: string;
  readonly ftsLanguage: string;
};

export const FTS_LANGUAGE_RE = /^[a-z_]+$/;

export const agentMemoryServiceConfig: AgentMemoryServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get natsUrl() {
    return process.env.NATS_URL ?? "nats://localhost:4222";
  },
  get ftsLanguage() {
    const lang = (process.env.MEMORY_FTS_LANGUAGE ?? "spanish").trim().toLowerCase();
    if (!FTS_LANGUAGE_RE.test(lang)) {
      throw new Error(
        `Invalid MEMORY_FTS_LANGUAGE value "${lang}". Must match /^[a-z_]+$/.`,
      );
    }
    return lang;
  },
};
