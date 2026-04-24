import { Module } from "@nestjs/common";
import { AggregatorEngine } from "./aggregator.engine";

/**
 * Wires the aggregator lifecycle. All heavy providers
 * (`UsageTenantConnectionManager`, NATS connection, JetStream
 * manager + client) come from the global `ProvidersModule`, so
 * this module stays focused on the stream-processing engine.
 */
@Module({
  providers: [AggregatorEngine],
})
export class AggregatorModule {}
