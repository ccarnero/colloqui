import { Global, Module } from "@nestjs/common";
import {
  type JetStreamManager,
  type NatsConnection,
  RetentionPolicy,
} from "nats";
import {
  createNatsConnectionProvider,
  createJetStreamPublisherProvider,
  ensureStream,
  NATS_CONNECTION,
} from "@yoizen/database";
import {
  PLATFORM_TENANTS_STREAM_NAME,
  PLATFORM_TENANTS_SUBJECT_PATTERN,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";

export const JETSTREAM_MANAGER = "TENANT_SERVICE_JETSTREAM_MANAGER";
export const JETSTREAM = "TENANT_SERVICE_JETSTREAM";

const jetStreamManagerFactory = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();
    await ensureStream(jsm, {
      name: PLATFORM_TENANTS_STREAM_NAME,
      subjects: [PLATFORM_TENANTS_SUBJECT_PATTERN],
      retention: RetentionPolicy.Workqueue,
    });
    return jsm;
  },
};

const jetStreamClientFactory = createJetStreamPublisherProvider({
  provide: JETSTREAM,
  managerToken: JETSTREAM_MANAGER,
});

@Global()
@Module({
  providers: [
    createNatsConnectionProvider("tenant-service"),
    jetStreamManagerFactory,
    jetStreamClientFactory,
  ],
  exports: [NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM],
})
export class TenantNatsModule {}
