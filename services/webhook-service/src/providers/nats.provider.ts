import { RetentionPolicy } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
} from "@yoizen/database";
import {
  STREAM_MAX_AGE_NS,
  DLQ_STREAM_NAME,
  DLQ_STREAM_SUBJECTS,
  DLQ_STREAM_MAX_BYTES,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

export const natsProvider: FactoryProvider =
  createNatsConnectionProvider("webhook-service");

export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [
      {
        name: DLQ_STREAM_NAME,
        subjects: DLQ_STREAM_SUBJECTS,
        maxAge: STREAM_MAX_AGE_NS,
        maxBytes: DLQ_STREAM_MAX_BYTES,
        retention: RetentionPolicy.Limits,
      },
    ],
    consumers: [],
  });

export const jetStreamPublisherProvider: FactoryProvider =
  createJetStreamPublisherProvider({
    provide: JETSTREAM_PUBLISHER,
    managerToken: JETSTREAM_MANAGER,
  });
