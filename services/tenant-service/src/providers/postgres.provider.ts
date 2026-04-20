import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import { METRICS_SCHEMA_SQL } from "@yoizen/shared";
import { tenantServiceConfig } from "../config";
import { K8S_CORE_API, K8S_APPS_API } from "./kubernetes.provider";
import { PinoLoggerService } from "@yoizen/observability";

const PG_PORT = 5432;

interface IKubernetesApiError {
  response?: {
    statusCode?: number;
  };
}

function isConflictError(error: unknown): boolean {
  const apiError = error as IKubernetesApiError;
  return apiError.response?.statusCode === 409;
}

const LABELS = {
  "app.kubernetes.io/name": "postgres",
  "app.kubernetes.io/component": "database",
  "app.kubernetes.io/managed-by": "tenant-service",
};

const POSTGRESQL_CONF = `listen_addresses = '*'
port = 5432
max_connections = 50
shared_buffers = 32MB
work_mem = 2MB
maintenance_work_mem = 16MB
effective_cache_size = 64MB
wal_level = replica
max_wal_size = 64MB
min_wal_size = 32MB
checkpoint_completion_target = 0.9
log_min_duration_statement = 500
random_page_cost = 1.1
effective_io_concurrency = 200
default_statistics_target = 100
`;

const INIT_SQL = `CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS events (
  id          TEXT        PRIMARY KEY,
  type        TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  metadata    JSONB       NOT NULL DEFAULT '{}',
  subject     TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON events (type, created_at DESC);

${METRICS_SCHEMA_SQL}
`;

@Injectable()
export class TenantPostgresProvisioner {
  private readonly logger = new PinoLoggerService(TenantPostgresProvisioner.name);

  constructor(
    @Inject(K8S_CORE_API) private readonly coreApi: k8s.CoreV1Api,
    @Inject(K8S_APPS_API) private readonly appsApi: k8s.AppsV1Api,
  ) {}

  async provision(namespace: string): Promise<void> {
    await this.createSecret(namespace);
    await this.createConfigMap(namespace);
    await this.createHeadlessService(namespace);
    await this.createService(namespace);
    await this.createStatefulSet(namespace);
    this.logger.log(`Provisioned PostgreSQL in namespace ${namespace}`);
  }

  /**
   * Runs a create call; ignores HTTP 409 Conflict (resource already exists).
   */
  private async createOrIgnore409(
    create: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await create();
    } catch (error: unknown) {
      if (isConflictError(error)) return;
      throw error;
    }
  }

  async waitForReady(namespace: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 2_000;

    while (Date.now() < deadline) {
      try {
        const ss = await this.appsApi.readNamespacedStatefulSet({
          name: "postgres",
          namespace,
        });
        if ((ss.status?.readyReplicas ?? 0) >= 1) {
          this.logger.log(`PostgreSQL ready in ${namespace}`);
          return;
        }
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        this.logger.debug(
          `StatefulSet postgres not ready or missing in ${namespace}: ${detail}`,
        );
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    this.logger.warn(`PostgreSQL readiness timeout in ${namespace}`);
  }

  private async createSecret(namespace: string): Promise<void> {
    const body: k8s.V1Secret = {
      metadata: { name: "postgres-credentials", namespace, labels: LABELS },
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
      metadata: { name: "postgres-config", namespace, labels: LABELS },
      data: {
        "postgresql.conf": POSTGRESQL_CONF,
        "init.sql": INIT_SQL,
      },
    };
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedConfigMap({ namespace, body }),
    );
  }

  /**
   * Shared ClusterIP Service spec for tenant Postgres (headless uses clusterIP: None).
   */
  private buildPostgresClusterIpService(
    namespace: string,
    serviceName: string,
    headless: boolean,
  ): k8s.V1Service {
    const spec: k8s.V1ServiceSpec = {
      type: "ClusterIP",
      selector: { "app.kubernetes.io/name": "postgres" },
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
    const body = this.buildPostgresClusterIpService(
      namespace,
      "postgres-headless",
      true,
    );
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedService({ namespace, body }),
    );
  }

  private async createService(namespace: string): Promise<void> {
    const body = this.buildPostgresClusterIpService(namespace, "postgres", false);
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedService({ namespace, body }),
    );
  }

  private buildPostgresInitContainer(): k8s.V1Container {
    return {
      name: "init-permissions",
      image: tenantServiceConfig.tenantPostgresContainerImage,
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

  private buildPostgresMainContainer(): k8s.V1Container {
    const probeCmd = [
      "pg_isready",
      "-U",
      tenantServiceConfig.postgresUser,
      "-d",
      tenantServiceConfig.postgresDb,
    ];
    return {
      name: "postgres",
      image: tenantServiceConfig.tenantPostgresContainerImage,
      ports: [
        { name: "postgres", containerPort: PG_PORT, protocol: "TCP" },
      ],
      envFrom: [{ secretRef: { name: "postgres-credentials" } }],
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
        requests: { cpu: "50m", memory: "64Mi" },
        limits: { cpu: "250m", memory: "128Mi" },
      },
      livenessProbe: {
        exec: { command: probeCmd },
        initialDelaySeconds: 15,
        periodSeconds: 20,
        timeoutSeconds: 5,
      },
      readinessProbe: {
        exec: { command: probeCmd },
        initialDelaySeconds: 5,
        periodSeconds: 10,
        timeoutSeconds: 5,
      },
      startupProbe: {
        exec: { command: probeCmd },
        failureThreshold: 30,
        periodSeconds: 2,
      },
    };
  }

  private buildPostgresPodVolumes(): k8s.V1Volume[] {
    return [
      {
        name: "config",
        configMap: {
          name: "postgres-config",
          items: [{ key: "postgresql.conf", path: "postgresql.conf" }],
        },
      },
      {
        name: "init",
        configMap: {
          name: "postgres-config",
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
        resources: { requests: { storage: "1Gi" } },
      },
    };
  }

  /** StatefulSet pod template, volumes, and PVC template (metadata set in caller). */
  private buildStatefulSetSpec(): k8s.V1StatefulSetSpec {
    return {
      serviceName: "postgres-headless",
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": "postgres" } },
      template: {
        metadata: { labels: LABELS },
        spec: {
          terminationGracePeriodSeconds: 30,
          securityContext: { fsGroup: 70 },
          initContainers: [this.buildPostgresInitContainer()],
          containers: [this.buildPostgresMainContainer()],
          volumes: this.buildPostgresPodVolumes(),
        },
      },
      volumeClaimTemplates: [this.buildDataVolumeClaimTemplate()],
    };
  }

  private async createStatefulSet(namespace: string): Promise<void> {
    const name = "postgres";
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
  providers: [TenantPostgresProvisioner],
  exports: [TenantPostgresProvisioner],
})
export class PostgresModule {}
