import {
  Global,
  Inject,
  Injectable,
  InternalServerErrorException,
  Module,
  type OnModuleDestroy,
} from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import postgres from "postgres";
import type { Sql } from "postgres";
import {
  ADAPTER_SCHEMA_SQL,
  AUTO_REPLY_SCHEMA_SQL,
  CHANNEL_ACCOUNTS_SCHEMA_SQL,
  TenantDatabaseTier,
  TENANT_AUTH_SCHEMA_SQL,
  WORKFLOW_SCHEMA_SQL,
  tenantPostgresDatabaseName,
  tenantPostgresRoleName,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";
import { tenantServiceConfig } from "../config";
import {
  decodeKubernetesSecretData,
  extractCnpgApplicationPassword,
  unwrapNamespacedSecretRead,
} from "./cnpg-credentials";
import { isKubernetesConflictError } from "./kubernetes-errors";
import { K8S_CORE_API, K8S_APPS_API } from "./kubernetes.provider";
import { PinoLoggerService } from "@yoizen/observability";

const PG_PORT = 5432;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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

${WORKFLOW_SCHEMA_SQL}

${ADAPTER_SCHEMA_SQL}

${CHANNEL_ACCOUNTS_SCHEMA_SQL}

${AUTO_REPLY_SCHEMA_SQL}

${TENANT_AUTH_SCHEMA_SQL}
`;

interface ITenantPostgresProvisionInput {
  readonly namespace: string;
  readonly tenantId: string;
  readonly tier: TenantDatabaseTierValue;
}

interface ISharedTenantDatabaseNames {
  readonly database: string;
  readonly role: string;
}

interface ISharedBootstrapCredentials {
  readonly username: string;
  readonly password: string;
}

@Injectable()
export class TenantPostgresProvisioner implements OnModuleDestroy {
  private readonly logger = new PinoLoggerService(TenantPostgresProvisioner.name);
  private sharedBootstrapCredentialsPromise: Promise<ISharedBootstrapCredentials> | null =
    null;
  private adminSqlPromise: Promise<Sql> | null = null;

  constructor(
    @Inject(K8S_CORE_API) private readonly coreApi: k8s.CoreV1Api,
    @Inject(K8S_APPS_API) private readonly appsApi: k8s.AppsV1Api,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.adminSqlPromise) {
      try {
        const sql = await this.adminSqlPromise;
        await sql.end({ timeout: 5 });
      } catch {
        /* ignore shutdown races */
      }
      this.adminSqlPromise = null;
    }
    this.sharedBootstrapCredentialsPromise = null;
  }

  async provision(input: string | ITenantPostgresProvisionInput): Promise<void> {
    const request = this.normalizeProvisionInput(input);
    if (request.tier === TenantDatabaseTier.Shared) {
      await this.provisionShared(request.tenantId, request.namespace);
      this.logger.log(
        `Provisioned shared PostgreSQL database for tenant ${request.tenantId}`,
      );
      return;
    }
    const namespace = request.namespace;
    await this.createSecret(namespace);
    await this.createConfigMap(namespace);
    await this.createHeadlessService(namespace);
    await this.createService(namespace);
    await this.createStatefulSet(namespace);
    this.logger.log(`Provisioned PostgreSQL in namespace ${namespace}`);
  }

  private normalizeProvisionInput(
    input: string | ITenantPostgresProvisionInput,
  ): ITenantPostgresProvisionInput {
    if (typeof input !== "string") {
      return input;
    }
    return {
      namespace: input,
      tenantId: input,
      tier: TenantDatabaseTier.Dedicated,
    };
  }

  /**
   * Provisions a shared-tier tenant on the platform-managed CloudNativePG
   * cluster AND materializes the per-tenant Kubernetes view that workloads in
   * the tenant namespace expect:
   *
   * - `Secret/postgres-credentials` with `POSTGRES_DB`, `POSTGRES_USER`,
   *   `POSTGRES_PASSWORD` carrying the tenant role/database/password (so
   *   manifests can `valueFrom.secretKeyRef` against the same Secret name as
   *   the dedicated tier — the runtime stays tier-agnostic).
   * - `Service/postgres` (`type: ExternalName`) aliasing the shared cluster's
   *   FQDN so consumers can `POSTGRES_HOST=postgres` regardless of tier.
   *
   * `namespace` MUST be the tenant Kubernetes namespace produced by
   * `tenantKubernetesNamespaceName(tenantId, env)`. The `createOrIgnore409`
   * wrapper keeps re-provisioning idempotent for namespaces that already
   * carry these objects from a previous run.
   */
  private async provisionShared(
    tenantId: string,
    namespace: string,
  ): Promise<void> {
    const names = this.sharedNames(tenantId);
    const admin = await this.getAdminSql();
    await this.ensureSharedRole(admin, names);
    await this.ensureSharedDatabase(admin, names);
    await this.ensureSharedDatabaseGrants(names);
    await this.createSharedSecret(namespace, names);
    await this.createSharedExternalNameService(namespace);
  }

  /**
   * Drops the shared-tier tenant database and login role on the shared cluster.
   *
   * Uses PostgreSQL 17 `DROP DATABASE ... WITH (FORCE)` to terminate any
   * lingering tenant connections (channel-service, auth-service pools) so the
   * caller doesn't have to coordinate connection draining across services.
   * Idempotent: missing database/role is treated as success so a tenant row
   * removed mid-provisioning still cleans up.
   */
  async deprovisionShared(tenantId: string): Promise<void> {
    const names = this.sharedNames(tenantId);
    const sql = await this.getAdminSql();
    await sql.unsafe(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(names.database)} WITH (FORCE)`,
    );
    await sql.unsafe(`DROP ROLE IF EXISTS ${quoteIdentifier(names.role)}`);
    this.logger.log(
      `Deprovisioned shared PostgreSQL database for tenant ${tenantId}`,
    );
  }

  private sharedNames(tenantId: string): ISharedTenantDatabaseNames {
    return {
      database: tenantPostgresDatabaseName(tenantId),
      role: tenantPostgresRoleName(tenantId),
    };
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
      if (isKubernetesConflictError(error)) return;
      throw error;
    }
  }

  /**
   * Shared-tier provisioning runs `CREATE ROLE` / `CREATE DATABASE`, which require
   * superuser or equivalent. CloudNativePG's app user (`yoizen`) cannot do that.
   * Use Secret `{cluster}-superuser` (requires `spec.enableSuperuserAccess: true`).
   */
  private async getSharedBootstrapCredentials(): Promise<ISharedBootstrapCredentials> {
    if (!this.sharedBootstrapCredentialsPromise) {
      this.sharedBootstrapCredentialsPromise =
        this.resolveSharedBootstrapCredentials();
    }
    return this.sharedBootstrapCredentialsPromise;
  }

  private async resolveSharedBootstrapCredentials(): Promise<ISharedBootstrapCredentials> {
    const explicit = process.env.TENANT_POSTGRES_SHARED_SUPERUSER_PASSWORD;
    if (explicit !== undefined && explicit.length > 0) {
      return {
        username:
          process.env.TENANT_POSTGRES_SHARED_SUPERUSER_USER ?? "postgres",
        password: explicit,
      };
    }
    return this.fetchCnpgSharedClusterSuperuserCredentials();
  }

  private async fetchCnpgSharedClusterSuperuserCredentials(): Promise<ISharedBootstrapCredentials> {
    const env = tenantServiceConfig.platformEnvironment;
    const namespace =
      process.env.TENANT_POSTGRES_SHARED_CREDENTIALS_NAMESPACE ??
      `support-services-${env}`;
    const secretName =
      process.env.TENANT_POSTGRES_SHARED_SUPERUSER_SECRET_NAME ??
      "postgres-shared-superuser";
    try {
      const res = await this.coreApi.readNamespacedSecret({
        name: secretName,
        namespace,
      });
      const secret = unwrapNamespacedSecretRead(res);
      const password = extractCnpgApplicationPassword(secret);
      const username =
        decodeKubernetesSecretData(secret, "username") ?? "postgres";
      if (!password) {
        throw new InternalServerErrorException(
          `CNPG superuser secret ${namespace}/${secretName} has no usable credentials (enable spec.enableSuperuserAccess on the Cluster and re-apply infrastructure, or set TENANT_POSTGRES_SHARED_SUPERUSER_PASSWORD).`,
        );
      }
      return { username, password };
    } catch (err: unknown) {
      if (err instanceof InternalServerErrorException) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(
        `Could not load CloudNativePG superuser credentials from ${namespace}/${secretName}: ${detail}. Set TENANT_POSTGRES_SHARED_SUPERUSER_PASSWORD or ensure the Cluster has enableSuperuserAccess: true and the superuser Secret exists.`,
      );
    }
  }

  private async getAdminSql(): Promise<Sql> {
    if (!this.adminSqlPromise) {
      this.adminSqlPromise = this.buildAdminSql();
    }
    return this.adminSqlPromise;
  }

  private async buildAdminSql(): Promise<Sql> {
    const { username, password } = await this.getSharedBootstrapCredentials();
    return postgres({
      host: tenantServiceConfig.sharedPostgresHost,
      port: tenantServiceConfig.sharedPostgresPort,
      database: tenantServiceConfig.sharedPostgresAdminDb,
      username,
      password,
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }

  private async ensureSharedRole(
    sql: Sql,
    names: ISharedTenantDatabaseNames,
  ): Promise<void> {
    const [existing] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${names.role}) AS exists
    `;
    const role = quoteIdentifier(names.role);
    const password = quoteLiteral(tenantServiceConfig.sharedPostgresTenantPassword);
    if (existing?.exists) {
      await sql.unsafe(`ALTER ROLE ${role} LOGIN PASSWORD ${password}`);
      return;
    }
    await sql.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD ${password}`);
  }

  private async ensureSharedDatabase(
    sql: Sql,
    names: ISharedTenantDatabaseNames,
  ): Promise<void> {
    const [existing] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM pg_database WHERE datname = ${names.database}
      ) AS exists
    `;
    if (existing?.exists) {
      await sql.unsafe(
        `ALTER DATABASE ${quoteIdentifier(names.database)} OWNER TO ${quoteIdentifier(names.role)}`,
      );
      return;
    }
    await sql.unsafe(
      `CREATE DATABASE ${quoteIdentifier(names.database)} OWNER ${quoteIdentifier(names.role)}`,
    );
  }

  private async ensureSharedDatabaseGrants(
    names: ISharedTenantDatabaseNames,
  ): Promise<void> {
    const { username, password } = await this.getSharedBootstrapCredentials();
    const tenantSql = postgres({
      host: tenantServiceConfig.sharedPostgresHost,
      port: tenantServiceConfig.sharedPostgresPort,
      database: names.database,
      username,
      password,
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
      prepare: false,
    });
    try {
      await tenantSql.unsafe(INIT_SQL);
      // INIT_SQL runs as the CNPG bootstrap superuser (`postgres`, OID 10).
      // Tables/sequences/indexes/views/materialized views in `public` end up
      // owned by that role, so tenant DDL such as `CREATE INDEX IF NOT EXISTS`
      // or `ALTER TABLE` from each service's lazy `ensureSchema` fails with
      // `must be owner of table <name>`. We can't `REASSIGN OWNED BY postgres`
      // (PostgreSQL rejects it: "cannot reassign ownership of objects owned by
      // role postgres because they are required by the database system"), so
      // we walk the user-owned objects in the public schema and re-own each
      // one. Idempotent: re-running on a tenant whose tables already point at
      // the tenant role is a no-op (filtered by `relowner <> tenant role`).
      await tenantSql.unsafe(
        `DO $do$
DECLARE
  r record;
  target_role CONSTANT name := ${quoteLiteral(names.role)};
  object_kind text;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, c.relkind, n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles owner_role ON owner_role.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p','v','m','S')
      AND owner_role.rolname <> target_role
  LOOP
    object_kind := CASE r.relkind
      WHEN 'r' THEN 'TABLE'
      WHEN 'p' THEN 'TABLE'
      WHEN 'v' THEN 'VIEW'
      WHEN 'm' THEN 'MATERIALIZED VIEW'
      WHEN 'S' THEN 'SEQUENCE'
    END;
    EXECUTE format('ALTER %s %I.%I OWNER TO %I',
      object_kind, r.nspname, r.relname, target_role);
  END LOOP;
END
$do$;`,
      );
      await tenantSql.unsafe(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(names.database)} TO ${quoteIdentifier(names.role)}`,
      );
      await tenantSql.unsafe(
        `GRANT USAGE, CREATE ON SCHEMA public TO ${quoteIdentifier(names.role)}`,
      );
      await tenantSql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(names.role)}`,
      );
      await tenantSql.unsafe(
        `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdentifier(names.role)}`,
      );
      await tenantSql.unsafe(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdentifier(names.role)}`,
      );
      await tenantSql.unsafe(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quoteIdentifier(names.role)}`,
      );
    } finally {
      await tenantSql.end();
    }
  }

  async waitForReady(
    namespace: string,
    tierOrTimeout: TenantDatabaseTierValue | number = TenantDatabaseTier.Dedicated,
    timeoutMs = 120_000,
  ): Promise<void> {
    const tier =
      typeof tierOrTimeout === "number"
        ? TenantDatabaseTier.Dedicated
        : tierOrTimeout;
    const timeout = typeof tierOrTimeout === "number" ? tierOrTimeout : timeoutMs;
    if (tier === TenantDatabaseTier.Shared) {
      const sql = await this.getAdminSql();
      await sql`SELECT 1`;
      return;
    }
    const deadline = Date.now() + timeout;
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

  /**
   * Shared-tier sibling of `createSecret`: the values are sourced from the
   * shared CNPG cluster (per-tenant database `tenant_<id>`, role
   * `tenant_<id>_app`, deterministic shared password) so consumers in the
   * tenant namespace can read the same Secret keys regardless of tier.
   */
  private async createSharedSecret(
    namespace: string,
    names: ISharedTenantDatabaseNames,
  ): Promise<void> {
    const body: k8s.V1Secret = {
      metadata: {
        name: "postgres-credentials",
        namespace,
        labels: { ...LABELS, "yoizen.io/postgres-tier": "shared" },
      },
      type: "Opaque",
      stringData: {
        POSTGRES_DB: names.database,
        POSTGRES_USER: names.role,
        POSTGRES_PASSWORD: tenantServiceConfig.sharedPostgresTenantPassword,
      },
    };
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedSecret({ namespace, body }),
    );
  }

  /**
   * Creates an `ExternalName` Service named `postgres` in the tenant namespace
   * that DNS-aliases the shared CNPG cluster. Lets workloads keep the
   * tier-agnostic `POSTGRES_HOST=postgres` env contract: dedicated tenants get
   * the per-namespace ClusterIP Service, shared tenants get this alias.
   */
  private async createSharedExternalNameService(
    namespace: string,
  ): Promise<void> {
    const body: k8s.V1Service = {
      metadata: {
        name: "postgres",
        namespace,
        labels: { ...LABELS, "yoizen.io/postgres-tier": "shared" },
      },
      spec: {
        type: "ExternalName",
        externalName: tenantServiceConfig.sharedPostgresHost,
        ports: [
          {
            name: "postgres",
            port: PG_PORT,
            targetPort: PG_PORT,
            protocol: "TCP",
          },
        ],
      },
    };
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedService({ namespace, body }),
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
