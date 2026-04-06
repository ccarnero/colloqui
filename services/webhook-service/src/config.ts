import { DEFAULT_ADAPTER_SERVICE_URL } from "@yoizen/shared";

type WebhookServiceConfig = {
  readonly port: number;
  readonly adapterServiceUrl: string;
};

export const webhookServiceConfig: WebhookServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  adapterServiceUrl:
    process.env.ADAPTER_SERVICE_URL ?? DEFAULT_ADAPTER_SERVICE_URL,
};
