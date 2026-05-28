import { Controller, Get, Inject, Optional } from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import {
  checkK8s,
  checkMongo,
  checkPostgres,
  type MongoClient,
  type Sql,
} from "@yoizen/database";
import { registryServiceConfig } from "../../config";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { POSTGRES_SQL } from "../../providers/postgres.module";

@Controller()
export class HealthController {
  constructor(
    @Inject(K8S_CORE_API)
    private readonly k8sApi: k8s.CoreV1Api,
    @Optional() @Inject(MONGO_CLIENT) private readonly mongo?: MongoClient,
    @Optional() @Inject(POSTGRES_SQL) private readonly sql?: Sql,
  ) {}

  @Get("health")
  async check(): Promise<{
    status: string;
    kubernetes: string;
    mongo?: string;
    postgres?: string;
  }> {
    const k8sOk = await checkK8s(this.k8sApi);

    if (registryServiceConfig.dbEngine === "mongo") {
      const mongoOk = this.mongo ? await checkMongo(this.mongo) : false;
      return {
        status: k8sOk && mongoOk ? "ok" : "degraded",
        kubernetes: k8sOk ? "connected" : "disconnected",
        mongo: mongoOk ? "connected" : "disconnected",
      };
    }

    const pgOk = this.sql ? await checkPostgres(this.sql) : false;
    return {
      status: k8sOk && pgOk ? "ok" : "degraded",
      kubernetes: k8sOk ? "connected" : "disconnected",
      postgres: pgOk ? "connected" : "disconnected",
    };
  }
}
