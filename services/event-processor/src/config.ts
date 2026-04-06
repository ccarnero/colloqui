import { DEFAULT_ADAPTER_SERVICE_URL } from "@yoizen/shared";

type EventProcessorConfig = {
  readonly port: number;
  readonly adapterServiceUrl: string;
};

export const eventProcessorConfig: EventProcessorConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  adapterServiceUrl:
    process.env.ADAPTER_SERVICE_URL ?? DEFAULT_ADAPTER_SERVICE_URL,
};
