import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import { createHash } from "node:crypto";
import { MongoClient } from "mongodb";
import { applyMongoSchema, type Db } from "@yoizen/database";
import {
  TenantDatabaseTier,
  tenantPostgresDatabaseName,
  tenantPostgresRoleName,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { tenantServiceConfig } from "../config";
import { isKubernetesConflictError } from "./kubernetes-errors";
import { K8S_CORE_API, K8S_APPS_API } from "./kubernetes.provider";
import {
  buildMongoSchemaInitScript,
  TENANT_OLTP_MONGO_SCHEMA,
  TENANT_USAGE_MONGO_SCHEMA,
} from "./tenant-mongo-init-script";

const MONGO_PORT = 27017;
const APP_NAME = "mongo";
const CONFIG_NAME = "mongo-config";
const SECRET_NAME = "mongo-credentials";
const HEADLESS_NAME = "mongo-headless";
const REPLICA_SET = "rs0";

const LABELS = {
  "app.kubernetes.io/name": APP_NAME,
  "app.kubernetes.io/component": "database",
  "app.kubernetes.io/managed-by": "tenant-service",
};

const MONGOD_CONF = `# Per-tenant MongoDB (single-node replica set in dev)
storage:
  dbPath: /data/db
# Write to stdout/stderr so 'kubectl logs mongo-0 -c mongo' surfaces
# startup + auth failures instead of vanishing into /var/log inside the
# pod. /proc/1/fd/1 is the canonical K8s-friendly stdout target.
systemLog:
  destination: file
  path: /proc/1/fd/1
  logAppend: true
net:
  port: 27017
  bindIpAll: true
replication:
  replSetName: rs0
`;

function buildInitReplicaSetScript(replicas: number): string {
  return `#!/usr/bin/env bash
set -euo pipefail

REPLICA_SET="${REPLICA_SET}"
HEADLESS="${HEADLESS_NAME}"
STATEFULSET="${APP_NAME}"
REPLICAS="${replicas}"
ROOT_USER="\${MONGO_ROOT_USER:?MONGO_ROOT_USER required}"
ROOT_PASS="\${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD required}"
APP_USER="\${MONGO_USER:?MONGO_USER required}"
APP_PASS="\${MONGO_PASSWORD:?MONGO_PASSWORD required}"
APP_DB="\${MONGO_DB:?MONGO_DB required}"
USAGE_DB="\${MONGO_USAGE_DB:?MONGO_USAGE_DB required}"

# rs.initiate() rejects members whose host string doesn't match what mongod
# thinks its own FQDN is. mongod resolves itself to
# '<pod>.<headless>.<ns>.svc.cluster.local', so the member host MUST use
# the same suffix or initiate fails with
# "No host described in new configuration ... maps to this node".
# Read the namespace from the auto-mounted SA token (always present).
POD_NS="$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)"
CLUSTER_DOMAIN="\${CLUSTER_DOMAIN:-svc.cluster.local}"

wait_for_mongo() {
  # TCP first — avoids spawning mongosh every 2s under memory pressure.
  until (echo > /dev/tcp/127.0.0.1/27017) 2>/dev/null; do
    sleep 2
  done
  until mongosh --quiet "mongodb://127.0.0.1:27017" \\
    --eval "db.adminCommand({ ping: 1 })" &>/dev/null; do
    sleep 3
  done
}

ordinal="\${HOSTNAME##*-}"
if [[ "\${ordinal}" != "0" ]]; then
  exit 0
fi

wait_for_mongo

members=""
for i in $(seq 0 $((REPLICAS - 1))); do
  host="\${STATEFULSET}-\${i}.\${HEADLESS}.\${POD_NS}.\${CLUSTER_DOMAIN}:27017"
  if [[ -n "\${members}" ]]; then
    members+=","
  fi
  members+="{ _id: \${i}, host: \\"\${host}\\" }"
done

mongosh --quiet "mongodb://127.0.0.1:27017" --eval "
  try { rs.status(); } catch (err) {
    rs.initiate({ _id: \\"\${REPLICA_SET}\\", members: [\${members}] });
  }
" || true

for _ in $(seq 1 60); do
  if mongosh --quiet "mongodb://127.0.0.1:27017" \\
    --eval "rs.isMaster().ismaster" 2>/dev/null | grep -q "true"; then
    break
  fi
  sleep 2
done

mongosh --quiet "mongodb://127.0.0.1:27017/admin" --eval "
  if (!db.getUser(\\"\${ROOT_USER}\\")) {
    db.createUser({
      user: \\"\${ROOT_USER}\\",
      pwd: \\"\${ROOT_PASS}\\",
      roles: [{ role: \\"root\\", db: \\"admin\\" }]
    });
  }
  if (!db.getUser(\\"\${APP_USER}\\")) {
    db.createUser({
      user: \\"\${APP_USER}\\",
      pwd: \\"\${APP_PASS}\\",
      roles: [
        { role: \\"readWrite\\", db: \\"\${APP_DB}\\" },
        { role: \\"dbAdmin\\", db: \\"\${APP_DB}\\" },
        { role: \\"readWrite\\", db: \\"\${USAGE_DB}\\" },
        { role: \\"dbAdmin\\", db: \\"\${USAGE_DB}\\" }
      ]
    });
  }
"

mongosh --quiet "mongodb://127.0.0.1:27017/\${APP_DB}" /scripts/init-tenant-schema.js
mongosh --quiet "mongodb://127.0.0.1:27017/\${USAGE_DB}" /scripts/init-tenant-usage-schema.js

echo "[mongo-init] replica set \${REPLICA_SET} ready with \${APP_DB} + \${USAGE_DB}"
exec sleep infinity
`;
}

const PROBE_TIMEOUT_MS = 3_000;

function encodeMongoCredential(value: string): string {
  return encodeURIComponent(value);
}

interface ITenantMongoProvisionInput {
  readonly namespace: string;
  readonly tenantId: string;
  readonly tier: TenantDatabaseTierValue;
}

interface ISharedTenantDatabaseNames {
  readonly database: string;
  readonly role: string;
}

@Injectable()
export class TenantMongoProvisioner implements OnModuleDestroy {
  private readonly logger = new PinoLoggerService(TenantMongoProvisioner.name);
  private sharedAdminClientPromise: Promise<MongoClient> | null = null;

  constructor(
    @Inject(K8S_CORE_API) private readonly coreApi: k8s.CoreV1Api,
    @Inject(K8S_APPS_API) private readonly appsApi: k8s.AppsV1Api,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.sharedAdminClientPromise) {
      try {
        const client = await this.sharedAdminClientPromise;
        await client.close();
      } catch {
        /* ignore shutdown races */
      }
      this.sharedAdminClientPromise = null;
    }
  }

  async provision(input: string | ITenantMongoProvisionInput): Promise<void> {
    const request = this.normalizeProvisionInput(input);
    if (request.tier === TenantDatabaseTier.Shared) {
      await this.provisionShared(request.tenantId, request.namespace);
      this.logger.log(
        `Provisioned shared MongoDB database for tenant ${request.tenantId}`,
      );
      return;
    }
    const namespace = request.namespace;
    await this.createSecret(namespace);
    await this.createConfigMap(namespace);
    await this.createHeadlessService(namespace);
    await this.createService(namespace);
    await this.createStatefulSet(namespace);
    this.logger.log(`Provisioned MongoDB in namespace ${namespace}`);
  }

  private normalizeProvisionInput(
    input: string | ITenantMongoProvisionInput,
  ): ITenantMongoProvisionInput {
    if (typeof input !== "string") {
      return input;
    }
    return {
      namespace: input,
      tenantId: input,
      tier: TenantDatabaseTier.Dedicated,
    };
  }

  private async provisionShared(
    tenantId: string,
    namespace: string,
  ): Promise<void> {
    const names = this.sharedNames(tenantId);
    await this.ensureSharedDatabaseAndUser(names);
    await this.createSharedSecret(namespace, names);
    await this.createSharedExternalNameService(namespace);
  }

  async deprovisionShared(tenantId: string): Promise<void> {
    const names = this.sharedNames(tenantId);
    const client = await this.getSharedAdminClient();
    const admin = client.db("admin");
    await client.db(names.database).dropDatabase();
    try {
      await admin.command({ dropUser: names.role });
    } catch {
      /* user may already be gone */
    }
    this.logger.log(`Deprovisioned shared MongoDB database for tenant ${tenantId}`);
  }

  private sharedNames(tenantId: string): ISharedTenantDatabaseNames {
    return {
      database: tenantPostgresDatabaseName(tenantId),
      role: tenantPostgresRoleName(tenantId),
    };
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

  private async getSharedAdminClient(): Promise<MongoClient> {
    if (!this.sharedAdminClientPromise) {
      this.sharedAdminClientPromise = this.buildSharedAdminClient();
    }
    return this.sharedAdminClientPromise;
  }

  private async buildSharedAdminClient(): Promise<MongoClient> {
    const { username, password } = this.resolveSharedBootstrapCredentials();
    const uri = this.buildMongoUri(
      tenantServiceConfig.sharedMongoHost,
      tenantServiceConfig.sharedMongoPort,
      "admin",
      username,
      password,
    );
    const client = new MongoClient(uri, { maxPoolSize: 2 });
    await client.connect();
    return client;
  }

  private resolveSharedBootstrapCredentials(): {
    readonly username: string;
    readonly password: string;
  } {
    const explicit = process.env.TENANT_MONGO_SHARED_ROOT_PASSWORD;
    if (explicit !== undefined && explicit.length > 0) {
      return {
        username: process.env.TENANT_MONGO_SHARED_ROOT_USER ?? "root",
        password: explicit,
      };
    }
    return {
      username: tenantServiceConfig.sharedMongoAdminUser,
      password: tenantServiceConfig.sharedMongoAdminPassword,
    };
  }

  private buildMongoUri(
    host: string,
    port: number,
    database: string,
    username: string,
    password: string,
  ): string {
    const user = encodeURIComponent(username);
    const pw = encodeURIComponent(password);
    return `mongodb://${user}:${pw}@${host}:${port}/${database}?authSource=admin`;
  }

  private async ensureSharedDatabaseAndUser(
    names: ISharedTenantDatabaseNames,
  ): Promise<void> {
    const client = await this.getSharedAdminClient();
    const admin = client.db("admin");
    const tenantPassword = tenantServiceConfig.sharedMongoTenantPassword;
    const roles = [
      { role: "readWrite", db: names.database },
      { role: "dbAdmin", db: names.database },
    ];

    try {
      await admin.command({
        createUser: names.role,
        pwd: tenantPassword,
        roles,
      });
    } catch {
      await admin.command({
        updateUser: names.role,
        pwd: tenantPassword,
        roles,
      });
    }

    await applyMongoSchema(
      client.db(names.database) as unknown as Db,
      TENANT_OLTP_MONGO_SCHEMA,
    );
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
    if (tier === TenantDatabaseTier.Shared) {
      const client = await this.getSharedAdminClient();
      await client.db("admin").command({ ping: 1 });
      return;
    }
    const deadline = Date.now() + timeout;
    const pollInterval = 2_000;
    let statefulSetReady = false;

    while (Date.now() < deadline) {
      if (!statefulSetReady) {
        try {
          const ss = await this.appsApi.readNamespacedStatefulSet({
            name: APP_NAME,
            namespace,
          });
          if ((ss.status?.readyReplicas ?? 0) >= 1) {
            statefulSetReady = true;
            this.logger.debug(
              `MongoDB StatefulSet ready in ${namespace}; waiting for replica set + tenant auth`,
            );
          }
        } catch (e: unknown) {
          const detail = e instanceof Error ? e.message : String(e);
          this.logger.debug(
            `StatefulSet ${APP_NAME} not ready or missing in ${namespace}: ${detail}`,
          );
        }
      }

      if (
        statefulSetReady &&
        (await this.probeDedicatedMongoReady(namespace))
      ) {
        this.logger.log(`MongoDB ready in ${namespace}`);
        return;
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(`MongoDB readiness timeout in ${namespace}`);
  }

  /**
   * Verifies dedicated tenant Mongo accepts authenticated writes on the primary.
   * Gates yoizenclaw-runtime until the replica-set-init sidecar finishes.
   */
  private async probeDedicatedMongoReady(namespace: string): Promise<boolean> {
    const uri = this.buildDedicatedMongoUri(namespace);
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: PROBE_TIMEOUT_MS,
      connectTimeoutMS: PROBE_TIMEOUT_MS,
    });
    try {
      await client.connect();
      const db = client.db(tenantServiceConfig.mongoDb);
      await db.command({ ping: 1 });
      const hello = (await client.db("admin").command({ hello: 1 })) as {
        isWritablePrimary?: boolean;
        ismaster?: boolean;
      };
      return hello.isWritablePrimary === true || hello.ismaster === true;
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      this.logger.debug(
        `Dedicated Mongo probe pending in ${namespace}: ${detail}`,
      );
      return false;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private buildDedicatedMongoUri(namespace: string): string {
    const host = `${APP_NAME}.${namespace}.svc.cluster.local`;
    const user = encodeMongoCredential(tenantServiceConfig.mongoUser);
    const password = encodeMongoCredential(tenantServiceConfig.mongoPassword);
    const database = tenantServiceConfig.mongoDb;
    return (
      `mongodb://${user}:${password}@${host}:${MONGO_PORT}/${database}` +
      `?authSource=admin&replicaSet=${REPLICA_SET}`
    );
  }

  private mongoInitConfigHash(): string {
    return createHash("sha256")
      .update(JSON.stringify(this.buildInitScripts()))
      .digest("hex")
      .slice(0, 12);
  }

  private async createSecret(namespace: string): Promise<void> {
    const body: k8s.V1Secret = {
      metadata: { name: SECRET_NAME, namespace, labels: LABELS },
      type: "Opaque",
      stringData: {
        MONGO_DB: tenantServiceConfig.mongoDb,
        MONGO_USAGE_DB: tenantServiceConfig.mongoUsageDb,
        MONGO_USER: tenantServiceConfig.mongoUser,
        MONGO_PASSWORD: tenantServiceConfig.mongoPassword,
        MONGO_ROOT_USER: tenantServiceConfig.mongoRootUser,
        MONGO_ROOT_PASSWORD: tenantServiceConfig.mongoRootPassword,
      },
    };
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedSecret({ namespace, body }),
    );
  }

  private async createSharedSecret(
    namespace: string,
    names: ISharedTenantDatabaseNames,
  ): Promise<void> {
    const body: k8s.V1Secret = {
      metadata: {
        name: SECRET_NAME,
        namespace,
        labels: { ...LABELS, "yoizen.io/mongo-tier": "shared" },
      },
      type: "Opaque",
      stringData: {
        MONGO_DB: names.database,
        MONGO_USER: names.role,
        MONGO_PASSWORD: tenantServiceConfig.sharedMongoTenantPassword,
      },
    };
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedSecret({ namespace, body }),
    );
  }

  private async createSharedExternalNameService(
    namespace: string,
  ): Promise<void> {
    const body: k8s.V1Service = {
      metadata: {
        name: APP_NAME,
        namespace,
        labels: { ...LABELS, "yoizen.io/mongo-tier": "shared" },
      },
      spec: {
        type: "ExternalName",
        externalName: tenantServiceConfig.sharedMongoHost,
        ports: [
          {
            name: "mongo",
            port: MONGO_PORT,
            targetPort: MONGO_PORT,
            protocol: "TCP",
          },
        ],
      },
    };
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedService({ namespace, body }),
    );
  }

  private buildInitScripts(): Record<string, string> {
    return {
      "mongod.conf": MONGOD_CONF,
      "init-replica-set.sh": buildInitReplicaSetScript(1),
      "init-tenant-schema.js": buildMongoSchemaInitScript(
        tenantServiceConfig.mongoDb,
        TENANT_OLTP_MONGO_SCHEMA,
      ),
      "init-tenant-usage-schema.js": buildMongoSchemaInitScript(
        tenantServiceConfig.mongoUsageDb,
        TENANT_USAGE_MONGO_SCHEMA,
      ),
    };
  }

  private async createConfigMap(namespace: string): Promise<void> {
    const body: k8s.V1ConfigMap = {
      metadata: { name: CONFIG_NAME, namespace, labels: LABELS },
      data: this.buildInitScripts(),
    };
    try {
      await this.coreApi.createNamespacedConfigMap({ namespace, body });
    } catch (error: unknown) {
      if (!isKubernetesConflictError(error)) {
        throw error;
      }
      await this.replaceConfigMap(namespace, body);
    }
  }

  private async replaceConfigMap(
    namespace: string,
    desired: k8s.V1ConfigMap,
  ): Promise<void> {
    const live = await this.coreApi.readNamespacedConfigMap({
      name: CONFIG_NAME,
      namespace,
    });
    const merged: k8s.V1ConfigMap = {
      ...live,
      metadata: {
        ...live.metadata,
        labels: { ...live.metadata?.labels, ...LABELS },
      },
      data: desired.data,
    };
    await this.coreApi.replaceNamespacedConfigMap({
      name: CONFIG_NAME,
      namespace,
      body: merged,
    });
    this.logger.log(`Reconciled MongoDB ConfigMap in ${namespace}`);
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
          name: "mongo",
          port: MONGO_PORT,
          targetPort: MONGO_PORT,
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
    const body = this.buildClusterIpService(namespace, APP_NAME, false);
    await this.createOrIgnore409(() =>
      this.coreApi.createNamespacedService({ namespace, body }),
    );
  }

  private buildMongoMainContainer(): k8s.V1Container {
    const probeCmd = [
      "mongosh",
      "--quiet",
      "--eval",
      "db.adminCommand({ ping: 1 })",
    ];
    return {
      name: APP_NAME,
      image: tenantServiceConfig.tenantMongoContainerImage,
      ports: [{ name: "mongo", containerPort: MONGO_PORT, protocol: "TCP" }],
      command: ["mongod"],
      args: ["--config", "/etc/mongo/mongod.conf"],
      volumeMounts: [
        {
          name: "config",
          mountPath: "/etc/mongo",
          readOnly: true,
        },
        {
          name: "data",
          mountPath: "/data/db",
        },
      ],
      resources: {
        requests: { cpu: "100m", memory: "256Mi" },
        limits: { cpu: "500m", memory: "512Mi" },
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
        failureThreshold: 30,
        periodSeconds: 2,
        timeoutSeconds: 5,
      },
    };
  }

  private buildReplicaSetInitContainer(): k8s.V1Container {
    return {
      name: "replica-set-init",
      image: tenantServiceConfig.tenantMongoContainerImage,
      command: ["/bin/bash", "/scripts/init-replica-set.sh"],
      envFrom: [{ secretRef: { name: SECRET_NAME } }],
      volumeMounts: [
        {
          name: "init-scripts",
          mountPath: "/scripts",
          readOnly: true,
        },
      ],
      resources: {
        requests: { cpu: "50m", memory: "128Mi" },
        limits: { cpu: "200m", memory: "256Mi" },
      },
    };
  }

  private buildPodVolumes(): k8s.V1Volume[] {
    return [
      {
        name: "config",
        configMap: {
          name: CONFIG_NAME,
          items: [{ key: "mongod.conf", path: "mongod.conf" }],
        },
      },
      {
        name: "init-scripts",
        configMap: {
          name: CONFIG_NAME,
          defaultMode: 0o755,
          items: [
            { key: "init-replica-set.sh", path: "init-replica-set.sh" },
            { key: "init-tenant-schema.js", path: "init-tenant-schema.js" },
            {
              key: "init-tenant-usage-schema.js",
              path: "init-tenant-usage-schema.js",
            },
          ],
        },
      },
    ];
  }

  private buildStatefulSetSpec(): k8s.V1StatefulSetSpec {
    return {
      serviceName: HEADLESS_NAME,
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": APP_NAME } },
      template: {
        metadata: {
          labels: LABELS,
          annotations: {
            "yoizen.io/mongo-init-config-hash": this.mongoInitConfigHash(),
          },
        },
        spec: {
          terminationGracePeriodSeconds: 30,
          securityContext: { fsGroup: 999 },
          containers: [
            this.buildMongoMainContainer(),
            this.buildReplicaSetInitContainer(),
          ],
          volumes: this.buildPodVolumes(),
        },
      },
      volumeClaimTemplates: [
        {
          metadata: { name: "data" },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: { requests: { storage: "2Gi" } },
          },
        },
      ],
    };
  }

  /**
   * Idempotent reconcile: create on first provision; on HTTP 409 replace the
   * pod template so probe/resource fixes in tenant-service converge without
   * manual `kubectl patch` after redeploys.
   */
  private async createStatefulSet(namespace: string): Promise<void> {
    const body: k8s.V1StatefulSet = {
      metadata: { name: APP_NAME, namespace, labels: LABELS },
      spec: this.buildStatefulSetSpec(),
    };
    try {
      await this.appsApi.createNamespacedStatefulSet({ namespace, body });
      return;
    } catch (error: unknown) {
      if (!isKubernetesConflictError(error)) {
        throw error;
      }
    }
    await this.replaceStatefulSet(namespace, body);
  }

  /**
   * Conflict path: inherit `metadata.resourceVersion` and immutable SS fields
   * (`selector`, `volumeClaimTemplates`) from the live object, then replace
   * with the desired pod template (probes, images, sidecars).
   */
  private async replaceStatefulSet(
    namespace: string,
    desired: k8s.V1StatefulSet,
  ): Promise<void> {
    const live = await this.appsApi.readNamespacedStatefulSet({
      name: APP_NAME,
      namespace,
    });

    const desiredTemplate = desired.spec?.template ?? live.spec?.template;
    if (!desiredTemplate) {
      throw new Error(
        `Cannot reconcile MongoDB StatefulSet in ${namespace}: missing pod template`,
      );
    }
    const liveSpec = live.spec;
    if (!liveSpec) {
      throw new Error(
        `Cannot reconcile MongoDB StatefulSet in ${namespace}: missing spec`,
      );
    }

    const merged: k8s.V1StatefulSet = {
      ...live,
      metadata: {
        ...live.metadata,
        labels: { ...live.metadata?.labels, ...LABELS },
      },
      spec: {
        ...liveSpec,
        replicas: desired.spec?.replicas ?? liveSpec.replicas,
        template: desiredTemplate,
      },
    };

    await this.appsApi.replaceNamespacedStatefulSet({
      name: APP_NAME,
      namespace,
      body: merged,
    });
    this.logger.log(`Reconciled MongoDB StatefulSet in ${namespace}`);
  }
}

@Global()
@Module({
  providers: [TenantMongoProvisioner],
  exports: [TenantMongoProvisioner],
})
export class MongoModule {}
