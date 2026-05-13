import { InternalServerErrorException } from "@nestjs/common";
import path from "node:path";

function requirePostgresPassword(): string {
  const pw = process.env.POSTGRES_PASSWORD;
  if (!pw) {
    throw new InternalServerErrorException(
      "POSTGRES_PASSWORD environment variable is required",
    );
  }
  return pw;
}

type YoizenclawAdminServiceConfig = {
  readonly port: number;
  readonly postgresPort: number;
  readonly postgresUser: string;
  readonly postgresPassword: string;
  readonly platformEnvironment: string;
  readonly validateAdapterRefs: boolean;
  readonly adapterServiceUrl: string;
  readonly natsUrl: string;
  readonly templatesYamlPath: string;
  /** NATS request timeout for chat (ms). */
  readonly chatRequestTimeoutMs: number;
};

export const yoizenclawAdminServiceConfig: YoizenclawAdminServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  postgresPort: Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
  postgresUser: process.env.POSTGRES_USER ?? "yoizen",
  postgresPassword: requirePostgresPassword(),
  platformEnvironment: process.env.PLATFORM_ENVIRONMENT ?? "dev",
  validateAdapterRefs:
    (process.env.VALIDATE_ADAPTER_REFS ?? "true") !== "false",
  adapterServiceUrl:
    process.env.CONNECTOR_ADMIN_URL ??
    process.env.ADAPTER_SERVICE_URL ??
    "http://connector-admin-api:3000",
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
  templatesYamlPath: path.join(process.cwd(), "data", "templates.yaml"),
  chatRequestTimeoutMs: Number.parseInt(
    process.env.YOIZENCLAW_CHAT_REQUEST_TIMEOUT_MS ?? "30000",
    10,
  ),
};
