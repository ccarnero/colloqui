export const runtimeGatewayConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
};
