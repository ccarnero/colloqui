import { Global, Module } from "@nestjs/common";
import { registryServiceConfig } from "../config";
import { MongoModule } from "./mongo.provider";
import { PostgresModule } from "./postgres.module";

const engine = registryServiceConfig.dbEngine;

@Global()
@Module({
  imports: engine === "postgres" ? [PostgresModule] : [MongoModule],
})
export class ProvidersModule {}
