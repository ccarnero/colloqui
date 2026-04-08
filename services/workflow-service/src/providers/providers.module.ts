import { Global, Module } from "@nestjs/common";
import { temporalClientProvider, TEMPORAL_CLIENT } from "./temporal.provider";
import { PostgresModule } from "./postgres.provider";
import {
  createNatsConnectionProvider,
  NATS_CONNECTION,
} from "@yoizen/database";

const natsProvider = createNatsConnectionProvider("workflow-service");

@Global()
@Module({
  imports: [PostgresModule],
  providers: [temporalClientProvider, natsProvider],
  exports: [PostgresModule, TEMPORAL_CLIENT, NATS_CONNECTION],
})
export class ProvidersModule {}
