import { Global, Module } from "@nestjs/common";
import { temporalClientProvider, TEMPORAL_CLIENT } from "./temporal.provider";
import { natsProvider, NATS_CONNECTION } from "./nats.provider";
import { postgresProvider, POSTGRES_SQL } from "./postgres.provider";

@Global()
@Module({
  providers: [temporalClientProvider, natsProvider, postgresProvider],
  exports: [TEMPORAL_CLIENT, NATS_CONNECTION, POSTGRES_SQL],
})
export class ProvidersModule {}
