import { Module } from "@nestjs/common";
import { provisioningServiceConfig } from "../../config";
import { NatsModule } from "../../providers/nats.module";
import { ManifestsModule } from "../manifests/manifests.module";
import { PlanModule } from "../plan/plan.module";
import { SecretsModule } from "../secrets/secrets.module";
import { ApplyController } from "./apply.controller";
import { ApplyService } from "./apply.service";
import { APPLY_EVENT_PUBLISHER } from "./domain/apply-event-publisher.interface";
import { PLATFORM_RESOURCE_WRITERS } from "./domain/platform-resource-writer.interface";
import type { ISecretValueResolver } from "./domain/secret-value-resolver.interface";
import { ApplyEventsPublisher } from "./infrastructure/apply-events.publisher";
import { BrokerSecretResolver } from "./infrastructure/broker-secret-resolver";
import {
  CONNECTOR_ENDPOINT_FETCHER,
  createConnectorEndpointFetcher,
} from "./infrastructure/connector-endpoint-fetcher";
import { buildPlatformResourceWriters } from "./infrastructure/platform-resource-writers.provider";

@Module({
  imports: [NatsModule, ManifestsModule, PlanModule, SecretsModule],
  providers: [
    ApplyService,
    ApplyEventsPublisher,
    { provide: APPLY_EVENT_PUBLISHER, useExisting: ApplyEventsPublisher },
    BrokerSecretResolver,
    {
      provide: PLATFORM_RESOURCE_WRITERS,
      useFactory: (resolver: ISecretValueResolver) =>
        buildPlatformResourceWriters(resolver),
      inject: [BrokerSecretResolver],
    },
    // manual-loops/provisioning-manifest-gaps-4.md T03 — the live
    // `GET /connectors/:id` closure `resolveServiceEnvRefs` needs for the
    // `{ connectorRef, endpointMethod, endpointPath }` shape, wired to the
    // SAME connector-admin base URL the connector writer/client already use.
    {
      provide: CONNECTOR_ENDPOINT_FETCHER,
      useFactory: () =>
        createConnectorEndpointFetcher(
          provisioningServiceConfig.downstreamServiceUrls.connectors
        ),
    },
  ],
  controllers: [ApplyController],
  exports: [ApplyService],
})
export class ApplyModule {}
