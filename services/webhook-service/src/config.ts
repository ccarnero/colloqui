import { platformServiceUrl } from "@yoizen/shared";

const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

type WebhookServiceConfig = {
  readonly port: number;
  readonly adapterServiceUrl: string;
};

export const webhookServiceConfig: WebhookServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  adapterServiceUrl:
    process.env.ADAPTER_SERVICE_URL ??
    platformServiceUrl("adapter-service-api", env),
};
