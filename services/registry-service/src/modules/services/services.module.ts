import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "../../providers/nats.provider";
import { registryServiceConfig } from "../../config";
import { ServicesController } from "./services.controller";
import { ServicesMongoRepository } from "./services.mongo.repository";
import { ServicesPostgresRepository } from "./services.postgres.repository";
import {
  SERVICES_REPOSITORY,
  type IServicesRepository,
} from "./services.repository.interface";
import { ServicesService } from "./services.service";
import { ServiceEventsMetrics } from "./service-events.metrics";
import { ServiceEventsPublisher } from "./service-events.publisher";

@Module({
  controllers: [ServicesController],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    createRepositoryProvider<IServicesRepository>({
      token: SERVICES_REPOSITORY,
      engine: registryServiceConfig.dbEngine,
      postgresClass: ServicesPostgresRepository,
      mongoClass: ServicesMongoRepository,
    }),
    ServicesService,
    ServiceEventsMetrics,
    ServiceEventsPublisher,
  ],
  exports: [NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM],
})
export class ServicesModule {}
