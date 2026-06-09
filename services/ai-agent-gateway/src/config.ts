import { platformServiceUrl } from "@yoizen/shared";

const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

export const aiAgentGatewayConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
  services: {
    agentAi:
      process.env.AGENT_AI_SERVICE_URL ??
      platformServiceUrl("agent-ai-service", env),
  },
};
