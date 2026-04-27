import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import {
  CHANNEL_USAGE_SCHEMA_SQL,
  TenantDatabaseTier,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";
import { tenantServiceConfig } from "../config";
import { isKubernetesConflictError } from "./kubernetes-errors";
import { K8S_CORE_API, K8S_APPS_API } from "./kubernetes.provider";
import { PinoLoggerService } from "@yoizen/observability";

const PG_PORT = 5432;

const APP_NAME = "postgres-usage";
const CONFIG_NAME = "postgres-usage-config";
const SECRET_NAME = "postgres-usage-credentials";
const SERVICE_NAME = "postgres-usage";
const HEADLESS_NAME = "postgres-usage-headless";

const LABELS = {
  "app.kubernetes.io/name": APP_NAME,
  "app.kubernetes.io/component": "usage-database",
  "app.kubernetes.io/managed-by": "tenant-service",
};

const POSTGRESQL_CONF = `listen_addresses = '*'
port = 5432
shared_preload_libraries = 'timescaledb'
max_connections = 50
shared_buffers = 64MB
work_mem = 8MB
maintenance_work_mem = 64MB
effective_cache_size = 128MB
wal_level = replica
max_wal_size = 128MB
min_wal_size = 64MB
checkpoint_completion_target = 0.9
random_page_cost = 1.1
effective_io_concurrency = 200
timescaledb.telemetry_level = off
`;

const INIT_SQL = `CREATE EXTENSION IF NOT EXISTS timescaledb;

${CHANNEL_USAGE_SCHEMA_SQL}
`;

/**
 * Provisions the **dedicated** per-tenant TimescaleDB instance used
 * exclusively for billing-grade usage metrics (`channel_events`
 * hypertable + continuous aggregates).
 *
 * Lives next to the tenant's main OLTP Postgres (`postgres` service)
 * but is a completely separate StatefulSet + PVC so that:
 *   - schema drift cannot poison the OLTP DB,
 *   - usage workloads have their own resource budget,
 *   - backup / retention policies can diverge (60d raw vs OLTP's
 *     indefinite),
 *   - TimescaleDB extension & tuning are isolated to this instance.
 *
 * Resource names all carry the `postgres-usage` suffix to keep them
 * unambiguously distinct from the main instance while reusing the
 * same namespace.
 */
@Injectable()
export class TenantUsagePostgresProvisioner {
  private readonly logger = new PinoLoggerService(
    TenantUsagePostgresProvisioner.name,
  );

  constructor(
    @Inject(K8S_CORE_API) private readonly coreApi: k8s.CoreV1Api,
    @Inject(K8S_APPS_API) private readonly appsApi: k8s.AppsV1Api,
  ) {}

  async provisionUsage(
    namespace: string,
    tier: TenantDatabaseTierValue = TenantDatabaseTier.Dedicated,
  ): Promise<void> {
    if (tier === TenantDatabaseTier.Shared) {
      this.logger.log(
        `Skipping dedicated TimescaleDB provisioning for shared tenant namespace ${namespace}`,
      );
      return;
    }
    await this.createSecret(namespace);
    await this.createConfigMap(namespace);
    await this.createHeadlessService(namespace);
    await this.createService(namespace);
    await this.createStatefulSet(namespace);
    this.logger.log(`Provisioned TimescaleDB (usage) in namespace ${namespace}`);
  }

  private async createOrIgnore409(
    create: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await create();
    } catch (error: unknown) {
      if (isKubernetesConflictError(error)) return;
      throw error;
    }
  }

  async waitForReady(
    namespace: string,
    tierOrTimeout: TenantDatabaseTierValue | number = TenantDatabaseTier.Dedicated,
    timeoutMs = 180_000,
  ): Promise<void> {
    const tier =
      typeof tierOrTimeout === "number"
        ? TenantDatabaseTier.Dedicated
        : tierOrTimeout;
    const timeout = typeof tierOrTimeout === "number" ? tierOrTimeout : timeoutMs;
    if (tier === TenantDatabaseTier.Shared) return;
    const deadline = Date.now() + timeout;
    const pollInterval = 2_000;

    while (Date.now() < deadline) {
      try {
        const ss = await this.appsApi.readNamespacedStatefulSet({
          name: APP_NAME,
          namespace,
        });
        if ((ss.status?.readyReplicas ?? 0) >= 1) {
          this.logger.log(`TimescaleDB (usage) ready in ${namespace}`);
          return;
        }
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        this.logger.debug(
          `StatefulSet ${APP_NAME} not ready or missing in ${namespace}: ${detail}`,
        );
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    this.logger.warn(`TimescaleDB (usage) readiness timeout in ${namespace}`);
  }

  private async createSecret(namespace: string): Promise<void> {
    const body: k8s.V1Secret = {
      metadata: { name: SECRET_NAME, namespace, labels: LABELS },
      type: "Opaque",
      stringData: {
        POSTGRES_DB: tenantServiceConfig.postgresDb,
        POSTGRES_USER: tenantServiceConfig.postgresUser,
        POSTGRES_PASSWORD: tenantServiceConfig.postgresPassword,
      },
    };
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedSecret({ namespace, body }),
    );
  }

  private async createConfigMap(namespace: string): Promise<void> {
    const body: k8s.V1ConfigMap = {
      metadata: { name: CONFIG_NAME, namespace, labels: LABELS },
      data: {
        "postgresql.conf": POSTGRESQL_CONF,
        "init.sql": INIT_SQL,
      },
    };
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedConfigMap({ namespace, body }),
    );
  }

  private buildClusterIpService(
    namespace: string,
    serviceName: string,
    headless: boolean,
  ): k8s.V1Service {
    const spec: k8s.V1ServiceSpec = {
      type: "ClusterIP",
      selector: { "app.kubernetes.io/name": APP_NAME },
      ports: [
        {
          name: "postgres",
          port: PG_PORT,
          targetPort: PG_PORT,
          protocol: "TCP",
        },
      ],
    };
    if (headless) {
      spec.clusterIP = "None";
    }
    return {
      metadata: { name: serviceName, namespace, labels: LABELS },
      spec,
    };
  }

  private async createHeadlessService(namespace: string): Promise<void> {
    const body = this.buildClusterIpService(namespace, HEADLESS_NAME, true);
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedService({ namespace, body }),
    );
  }

  private async createService(namespace: string): Promise<void> {
    const body = this.buildClusterIpService(namespace, SERVICE_NAME, false);
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedService({ namespace, body }),
    );
  }

  private buildInitContainer(): k8s.V1Container {
    return {
      name: "init-permissions",
      image: tenantServiceConfig.tenantUsagePostgresContainerImage,
      command: ["sh", "-c", "chown -R 70:70 /var/lib/postgresql/data"],
      securityContext: { runAsUser: 0 },
      volumeMounts: [
        {
          name: "data",
          mountPath: "/var/lib/postgresql/data",
          subPath: "pgdata",
        },
      ],
    };
  }

  private buildMainContainer(): k8s.V1Container {
    const probeCmd = [
      "pg_isready",
      "-U",
      tenantServiceConfig.postgresUser,
      "-d",
      tenantServiceConfig.postgresDb,
    ];
    return {
      name: "postgres",
      image: tenantServiceConfig.tenantUsagePostgresContainerImage,
      ports: [
        { name: "postgres", containerPort: PG_PORT, protocol: "TCP" },
      ],
      envFrom: [{ secretRef: { name: SECRET_NAME } }],
      args: ["-c", "config_file=/etc/postgresql/postgresql.conf"],
      volumeMounts: [
        {
          name: "config",
          mountPath: "/etc/postgresql",
          readOnly: true,
        },
        {
          name: "init",
          mountPath: "/docker-entrypoint-initdb.d",
          readOnly: true,
        },
        {
          name: "data",
          mountPath: "/var/lib/postgresql/data",
          subPath: "pgdata",
        },
      ],
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
        limits: { cpu: "500m", memory: "256Mi" },
      },
      livenessProbe: {
        exec: { command: probeCmd },
        initialDelaySeconds: 30,
        periodSeconds: 20,
        timeoutSeconds: 5,
      },
      readinessProbe: {
        exec: { command: probeCmd },
        initialDelaySeconds: 10,
        periodSeconds: 10,
        timeoutSeconds: 5,
      },
      startupProbe: {
        exec: { command: probeCmd },
        failureThreshold: 60,
        periodSeconds: 2,
      },
    };
  }

  private buildPodVolumes(): k8s.V1Volume[] {
    return [
      {
        name: "config",
        configMap: {
          name: CONFIG_NAME,
          items: [{ key: "postgresql.conf", path: "postgresql.conf" }],
        },
      },
      {
        name: "init",
        configMap: {
          name: CONFIG_NAME,
          items: [{ key: "init.sql", path: "init.sql" }],
        },
      },
    ];
  }

  private buildDataVolumeClaimTemplate(): k8s.V1PersistentVolumeClaim {
    return {
      metadata: { name: "data" },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: {
          requests: { storage: tenantServiceConfig.tenantUsagePostgresStorage },
        },
      },
    };
  }

  private buildStatefulSetSpec(): k8s.V1StatefulSetSpec {
    return {
      serviceName: HEADLESS_NAME,
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": APP_NAME } },
      template: {
        metadata: { labels: LABELS },
        spec: {
          terminationGracePeriodSeconds: 30,
          securityContext: { fsGroup: 70 },
          initContainers: [this.buildInitContainer()],
          containers: [this.buildMainContainer()],
          volumes: this.buildPodVolumes(),
        },
      },
      volumeClaimTemplates: [this.buildDataVolumeClaimTemplate()],
    };
  }

  private async createStatefulSet(namespace: string): Promise<void> {
    const name = APP_NAME;
    const body: k8s.V1StatefulSet = {
      metadata: { name, namespace, labels: LABELS },
      spec: this.buildStatefulSetSpec(),
    };
    await this.createOrIgnore409(() =>
      this.appsApi.createNamespacedStatefulSet({ namespace, body }),
    );
  }
}

@Global()
@Module({
  providers: [TenantUsagePostgresProvisioner],
  exports: [TenantUsagePostgresProvisioner],
})
export class UsagePostgresModule {}
