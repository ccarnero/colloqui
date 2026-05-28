import { Inject, Injectable, Optional } from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import {
  checkK8s,
  checkMongo,
  checkPostgres,
  type MongoClient,
  type Sql,
} from "@yoizen/database";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { MONGO_CLIENT } from "../../providers/platform-mongo.provider";
import { PLATFORM_POSTGRES_SQL } from "../../providers/platform-postgres.provider";
import { tenantServiceConfig } from "../../config";
import type {
  ITenantHealthResponse,
  ITenantProvisionerState,
} from "@yoizen/shared";
import { TenantProvisionConsumerService } from "../provisioning/tenant-provision-consumer.service";

@Injectable()
export class HealthService {
  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    private readonly provisionConsumer: TenantProvisionConsumerService,
    @Optional() @Inject(MONGO_CLIENT) private readonly mongo?: MongoClient,
    @Optional() @Inject(PLATFORM_POSTGRES_SQL) private readonly sql?: Sql,
  ) {}

  async getStatus(): Promise<ITenantHealthResponse> {
    const [k8sOk, catalogOk] = await Promise.all([
      checkK8s(this.k8sApi),
      this.checkCatalog(),
    ]);
    const provisioner: ITenantProvisionerState =
      this.provisionConsumer.getProvisionerState();

    const status = aggregateStatus(k8sOk, catalogOk, provisioner);

    return {
      status,
      kubernetes: k8sOk ? "connected" : "disconnected",
      mongo: catalogOk ? "connected" : "disconnected",
      provisioner,
    };
  }

  private async checkCatalog(): Promise<boolean> {
    if (tenantServiceConfig.dbEngine === "mongo") {
      return this.mongo ? checkMongo(this.mongo) : false;
    }
    return this.sql ? checkPostgres(this.sql) : false;
  }
}

function aggregateStatus(
  k8sOk: boolean,
  catalogOk: boolean,
  provisioner: ITenantProvisionerState,
): "ok" | "degraded" | "error" {
  if (provisioner === "stopped") return "error";
  if (!k8sOk || !catalogOk) return "degraded";
  if (provisioner === "degraded") return "degraded";
  return "ok";
}
