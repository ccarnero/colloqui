import { Global, Module } from "@nestjs/common";
import { temporalClientProvider, TEMPORAL_CLIENT } from "./temporal.provider";
import { postgresProvider, POSTGRES_SQL } from "./postgres.provider";

@Global()
@Module({
  providers: [temporalClientProvider, postgresProvider],
  exports: [TEMPORAL_CLIENT, POSTGRES_SQL],
})
export class ProvidersModule {}
