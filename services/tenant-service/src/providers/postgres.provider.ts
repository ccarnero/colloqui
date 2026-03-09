import { Global, Module, Inject, Injectable, Logger } from '@nestjs/common';
import type * as k8s from '@kubernetes/client-node';
import { K8S_CORE_API, K8S_APPS_API } from './kubernetes.provider';

const PG_IMAGE = 'postgres:17-alpine';
const PG_PORT = 5432;
const PG_DB = 'yoizen';
const PG_USER = 'yoizen';
const PG_PASSWORD = 'yoizen-dev-password';

const LABELS = {
  'app.kubernetes.io/name': 'postgres',
  'app.kubernetes.io/component': 'database',
  'app.kubernetes.io/managed-by': 'tenant-service',
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

const INIT_SQL = `CREATE TABLE IF NOT EXISTS events (
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

CREATE TABLE IF NOT EXISTS metrics (
  id          TEXT             PRIMARY KEY,
  source      TEXT             NOT NULL,
  name        TEXT             NOT NULL,
  value       DOUBLE PRECISION NOT NULL DEFAULT 0,
  tags        JSONB            NOT NULL DEFAULT '{}',
  metadata    JSONB            NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_metrics_source ON metrics (source);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics (name);
CREATE INDEX IF NOT EXISTS idx_metrics_source_created ON metrics (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON metrics (created_at DESC);
`;

@Injectable()
export class TenantPostgresProvisioner {
  private readonly logger = new Logger(TenantPostgresProvisioner.name);

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

  async waitForReady(namespace: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 2_000;

    while (Date.now() < deadline) {
      try {
        const ss = await this.appsApi.readNamespacedStatefulSet({
          name: 'postgres',
          namespace,
        });
        if ((ss.status?.readyReplicas ?? 0) >= 1) {
          this.logger.log(`PostgreSQL ready in ${namespace}`);
          return;
        }
      } catch {
        // StatefulSet may not exist yet
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    this.logger.warn(`PostgreSQL readiness timeout in ${namespace}`);
  }

  private async createSecret(namespace: string): Promise<void> {
    const body: k8s.V1Secret = {
      metadata: { name: 'postgres-credentials', namespace, labels: LABELS },
      type: 'Opaque',
      stringData: {
        POSTGRES_DB: PG_DB,
        POSTGRES_USER: PG_USER,
        POSTGRES_PASSWORD: PG_PASSWORD,
      },
    };
    try {
      await this.coreApi.createNamespacedSecret({ namespace, body });
    } catch (e: any) {
      if (e?.response?.statusCode === 409) return;
      throw e;
    }
  }

  private async createConfigMap(namespace: string): Promise<void> {
    const body: k8s.V1ConfigMap = {
      metadata: { name: 'postgres-config', namespace, labels: LABELS },
      data: {
        'postgresql.conf': POSTGRESQL_CONF,
        'init.sql': INIT_SQL,
      },
    };
    try {
      await this.coreApi.createNamespacedConfigMap({ namespace, body });
    } catch (e: any) {
      if (e?.response?.statusCode === 409) return;
      throw e;
    }
  }

  private async createHeadlessService(namespace: string): Promise<void> {
    const body: k8s.V1Service = {
      metadata: { name: 'postgres-headless', namespace, labels: LABELS },
      spec: {
        type: 'ClusterIP',
        clusterIP: 'None',
        selector: { 'app.kubernetes.io/name': 'postgres' },
        ports: [{ name: 'postgres', port: PG_PORT, targetPort: PG_PORT as any, protocol: 'TCP' }],
      },
    };
    try {
      await this.coreApi.createNamespacedService({ namespace, body });
    } catch (e: any) {
      if (e?.response?.statusCode === 409) return;
      throw e;
    }
  }

  private async createService(namespace: string): Promise<void> {
    const body: k8s.V1Service = {
      metadata: { name: 'postgres', namespace, labels: LABELS },
      spec: {
        type: 'ClusterIP',
        selector: { 'app.kubernetes.io/name': 'postgres' },
        ports: [{ name: 'postgres', port: PG_PORT, targetPort: PG_PORT as any, protocol: 'TCP' }],
      },
    };
    try {
      await this.coreApi.createNamespacedService({ namespace, body });
    } catch (e: any) {
      if (e?.response?.statusCode === 409) return;
      throw e;
    }
  }

  private async createStatefulSet(namespace: string): Promise<void> {
    const body: k8s.V1StatefulSet = {
      metadata: { name: 'postgres', namespace, labels: LABELS },
      spec: {
        serviceName: 'postgres-headless',
        replicas: 1,
        selector: { matchLabels: { 'app.kubernetes.io/name': 'postgres' } },
        template: {
          metadata: { labels: LABELS },
          spec: {
            terminationGracePeriodSeconds: 30,
            securityContext: { fsGroup: 70 },
            initContainers: [
              {
                name: 'init-permissions',
                image: PG_IMAGE,
                command: ['sh', '-c', 'chown -R 70:70 /var/lib/postgresql/data'],
                securityContext: { runAsUser: 0 },
                volumeMounts: [
                  { name: 'data', mountPath: '/var/lib/postgresql/data', subPath: 'pgdata' },
                ],
              },
            ],
            containers: [
              {
                name: 'postgres',
                image: PG_IMAGE,
                ports: [{ name: 'postgres', containerPort: PG_PORT, protocol: 'TCP' }],
                envFrom: [{ secretRef: { name: 'postgres-credentials' } }],
                args: ['-c', 'config_file=/etc/postgresql/postgresql.conf'],
                volumeMounts: [
                  { name: 'config', mountPath: '/etc/postgresql', readOnly: true },
                  { name: 'init', mountPath: '/docker-entrypoint-initdb.d', readOnly: true },
                  { name: 'data', mountPath: '/var/lib/postgresql/data', subPath: 'pgdata' },
                ],
                resources: {
                  requests: { cpu: '50m', memory: '64Mi' },
                  limits: { cpu: '250m', memory: '128Mi' },
                },
                livenessProbe: {
                  exec: { command: ['pg_isready', '-U', PG_USER, '-d', PG_DB] },
                  initialDelaySeconds: 15,
                  periodSeconds: 20,
                  timeoutSeconds: 5,
                },
                readinessProbe: {
                  exec: { command: ['pg_isready', '-U', PG_USER, '-d', PG_DB] },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                  timeoutSeconds: 5,
                },
                startupProbe: {
                  exec: { command: ['pg_isready', '-U', PG_USER, '-d', PG_DB] },
                  failureThreshold: 30,
                  periodSeconds: 2,
                },
              },
            ],
            volumes: [
              {
                name: 'config',
                configMap: {
                  name: 'postgres-config',
                  items: [{ key: 'postgresql.conf', path: 'postgresql.conf' }],
                },
              },
              {
                name: 'init',
                configMap: {
                  name: 'postgres-config',
                  items: [{ key: 'init.sql', path: 'init.sql' }],
                },
              },
            ],
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: 'data' },
            spec: {
              accessModes: ['ReadWriteOnce'],
              resources: { requests: { storage: '1Gi' } },
            },
          },
        ],
      },
    };
    try {
      await this.appsApi.createNamespacedStatefulSet({ namespace, body });
    } catch (e: any) {
      if (e?.response?.statusCode === 409) return;
      throw e;
    }
  }
}

@Global()
@Module({
  providers: [TenantPostgresProvisioner],
  exports: [TenantPostgresProvisioner],
})
export class PostgresModule {}
