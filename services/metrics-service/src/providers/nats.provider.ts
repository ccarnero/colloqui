import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  NATS_CONNECTION,
} from "@yoizen/database";

export { NATS_CONNECTION } from "@yoizen/database";

export const natsProvider: FactoryProvider = createNatsConnectionProvider("metrics-service");
