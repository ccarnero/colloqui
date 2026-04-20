import { Module } from "@nestjs/common";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "../../providers/nats.provider";
import { ServicesController } from "./services.controller";
import { ServicesRepository } from "./services.repository";
import { ServicesService } from "./services.service";
import { ServiceEventsPublisher } from "./service-events.publisher";

@Module({
  controllers: [ServicesController],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    ServicesRepository,
    ServicesService,
    ServiceEventsPublisher,
  ],
  exports: [NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM],
})
export class ServicesModule {}
