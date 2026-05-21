import type { FactoryProvider } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  createNatsConnectionProvider,
  ensureTenantIngressStream,
} from "@yoizen/database";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM = "JETSTREAM";

export const natsProvider: FactoryProvider =
  createNatsConnectionProvider("yoizenclaw-runtime-gateway");

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();
    return jsm;
  },
  inject: [NATS_CONNECTION],
};

export const jetStreamProvider: FactoryProvider = {
  provide: JETSTREAM,
  useFactory: (
    nc: NatsConnection,
    _jsm: JetStreamManager,
  ): JetStreamClient => nc.jetstream(),
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
};

export async function ensureGatewayTenantIngress(
  jsm: JetStreamManager,
  tenantId: string,
): Promise<void> {
  await ensureTenantIngressStream(jsm, tenantId);
}
