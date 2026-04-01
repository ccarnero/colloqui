import type { NatsConnection, JetStreamClient } from "nats";
import type { JetStreamManager } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  ensureStream,
  NATS_CONNECTION,
} from "@yoizen/database";
import {
  STREAM_NAME,
  STREAM_SUBJECTS,
  GATEWAY_AUDIT_STREAM_NAME,
  GATEWAY_AUDIT_STREAM_SUBJECTS,
  GATEWAY_AUDIT_STREAM_MAX_BYTES,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM = "JETSTREAM";

export const natsProvider: FactoryProvider = createNatsConnectionProvider();

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (
    nc: NatsConnection,
  ): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();
    await Promise.all([
      ensureStream(jsm, {
        name: STREAM_NAME,
        subjects: STREAM_SUBJECTS,
      }),
      ensureStream(jsm, {
        name: GATEWAY_AUDIT_STREAM_NAME,
        subjects: GATEWAY_AUDIT_STREAM_SUBJECTS,
        maxBytes: GATEWAY_AUDIT_STREAM_MAX_BYTES,
      }),
    ]);
    return jsm;
  },
};

export const jetStreamProvider: FactoryProvider = {
  provide: JETSTREAM,
  inject: [NATS_CONNECTION],
  useFactory: (nc: NatsConnection): JetStreamClient =>
    nc.jetstream(),
};
