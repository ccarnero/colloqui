import { randomUUID } from "node:crypto";
import type * as k8s from "@kubernetes/client-node";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { isStreamNotFoundError } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import {
  clampTenantStreamLimits,
  DEFAULT_TENANT_MESSAGING_TIER,
  getTenantStreamName,
  invalidPlatformEnvironmentMessage,
  ProvisioningStatus,
  type ProvisioningStatusValue,
  readMessagingCeilingsFromEnv,
  TENANT_TIER_LIMITS,
  TenantDatabaseTier,
  type TenantDatabaseTierValue,
  type TenantTier,
  tenantKubernetesNamespaceName,
} from "@yoizen/shared";
import type { JetStreamManager } from "nats";
import { tenantServiceConfig } from "../../config";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { JETSTREAM_MANAGER } from "../../providers/nats.module";
import { TenantDeletionPublisher } from "../../providers/tenant-deletion-publisher.service";
import { TenantProvisionPublisher } from "../../providers/tenant-provision-publisher.service";
import {
  type ITenantProvisioner,
  TENANT_PROVISIONER,
} from "../../providers/tenant-provisioner.interface";
import {
  type Environment,
  type ITenantRow,
  type TenantConfiguration,
  VALID_ENVIRONMENTS,
} from "./tenant.dto";
import {
  type ITenantsRepository,
  TENANTS_REPOSITORY,
} from "./tenants.repository.interface";

const LABEL_TENANT = "yoizen.io/tenant";
const LABEL_ENVIRONMENT = "yoizen.io/environment";
const LABEL_MANAGED_BY = "yoizen.io/managed-by";
const MANAGED_BY_VALUE = "tenant-service";

interface INamespaceStatus {
  name: string;
  environment: Environment;
  phase: string;
}

export interface ITenantDetail {
  id: string;
  name: string;
  tier: TenantDatabaseTierValue;
  messagingTier: TenantTier;
  configuration: TenantConfiguration;
  namespaces: INamespaceStatus[];
  mongoHost?: string;
  postgresHost?: string;
  provisioningStatus: ProvisioningStatusValue;
  provisioningError: string | null;
  provisioningStartedAt: Date | null;
  provisioningCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITenantSummary {
  id: string;
  name: string;
  environment: string;
  configuration: TenantConfiguration;
  provisioningStatus: ProvisioningStatusValue;
  tier: TenantDatabaseTierValue;
  messagingTier: TenantTier;
}

/** 202 Accepted body for POST /tenants (public path: /api/tenants/:id for status). */
export interface ICreateTenantAccepted {
  id: string;
  name: string;
  tier: TenantDatabaseTierValue;
  messagingTier: TenantTier;
  provisioningStatus: ProvisioningStatusValue;
  statusUrl: string;
}

function databaseHost(
  tenant: string,
  env: Environment,
  tier: TenantDatabaseTierValue
): { mongoHost?: string; postgresHost?: string } {
  if (tenantServiceConfig.dbEngine === "mongo") {
    return {
      mongoHost:
        tier === TenantDatabaseTier.Shared
          ? tenantServiceConfig.sharedMongoHost
          : `mongo.${tenantKubernetesNamespaceName(tenant, env)}.svc.cluster.local`,
    };
  }
  return {
    postgresHost:
      tier === TenantDatabaseTier.Shared
        ? tenantServiceConfig.sharedPostgresHost
        : `postgres.${tenantKubernetesNamespaceName(tenant, env)}.svc.cluster.local`,
  };
}

@Injectable()
export class TenantsService {
  private readonly logger = new PinoLoggerService(TenantsService.name);
  private readonly environment: Environment;

  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    @Inject(TENANTS_REPOSITORY) private readonly repository: ITenantsRepository,
    private readonly provisionPublisher: TenantProvisionPublisher,
    private readonly deletionPublisher: TenantDeletionPublisher,
    @Inject(TENANT_PROVISIONER) private readonly provisioner: ITenantProvisioner,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
  ) {
    const env = tenantServiceConfig.platformEnvironment;
    if (!VALID_ENVIRONMENTS.includes(env as Environment)) {
      throw new InternalServerErrorException(
        invalidPlatformEnvironmentMessage(env),
      );
    }
    this.environment = env as Environment;
    this.logger.log(`Tenant service scoped to environment: ${this.environment}`);
  }

  /**
   * Inserts platform row (pending), enqueues JetStream provision job, returns 202 payload.
   */
  async createTenant(
    name: string,
    tier: TenantDatabaseTierValue = TenantDatabaseTier.Shared,
    configuration: TenantConfiguration = {},
    messagingTier: TenantTier = DEFAULT_TENANT_MESSAGING_TIER
  ): Promise<ICreateTenantAccepted> {
    const existing = await this.repository.findByName(name);
    if (existing) {
      throw new ConflictException(`Tenant '${name}' already exists`);
    }

    const id = randomUUID();
    const row = await this.repository.create(
      id,
      name,
      tier,
      configuration,
      messagingTier
    );
    await this.provisionPublisher.publishProvisionRequested({
      tenantId: row.id,
      name: row.name,
      configuration: row.configuration,
    });

    return {
      id: row.id,
      name: row.name,
      tier: row.tier,
      messagingTier: row.messaging_tier,
      provisioningStatus: ProvisioningStatus.Pending,
      statusUrl: `/api/tenants/${row.id}`,
    };
  }

  /**
   * Lists tenants. When `filter.status` is provided, the platform DB is
   * queried with the filter pushed down so callers can ask for
   * `provisioning_status = 'ready'` and skip mid-provisioning
   * or failed rows in O(1) per row at the source.
   */
  async listTenants(filter?: {
    status?: ProvisioningStatusValue;
  }): Promise<ITenantSummary[]> {
    const rows = await this.repository.findAll(filter);
    const len = rows.length;
    const summaries: ITenantSummary[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const row = rows[i]!;
      summaries[i] = {
        id: row.id,
        name: row.name,
        environment: this.environment,
        tier: row.tier,
        messagingTier: row.messaging_tier,
        configuration: row.configuration,
        provisioningStatus: row.provisioning_status,
      };
    }
    return summaries;
  }

  async getTenantById(id: string): Promise<ITenantDetail> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new NotFoundException(`Tenant id '${id}' not found`);
    }
    return this.buildDetail(row);
  }

  /**
   * Returns tenant detail including namespace phases and Postgres host.
   */
  async getTenant(name: string): Promise<ITenantDetail> {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundException(`Tenant '${name}' not found`);
    }
    return this.buildDetail(row);
  }

  /**
   * Updates stored configuration JSON for the tenant.
   */
  async updateTenant(
    name: string,
    changes: {
      configuration?: TenantConfiguration;
      messagingTier?: TenantTier;
    }
  ): Promise<ITenantDetail> {
    const { configuration, messagingTier } = changes;
    if (configuration === undefined && messagingTier === undefined) {
      throw new BadRequestException(
        "PATCH body must carry at least one of: configuration, messagingTier"
      );
    }

    let row: ITenantRow | undefined;
    if (configuration !== undefined) {
      row = await this.repository.updateConfiguration(name, configuration);
      if (!row) {
        throw new NotFoundException(`Tenant '${name}' not found`);
      }
    }
    if (messagingTier !== undefined) {
      const current = row ?? (await this.repository.findByName(name));
      if (!current) {
        throw new NotFoundException(`Tenant '${name}' not found`);
      }
      if (current.messaging_tier === messagingTier) {
        // Idempotent: same tier means no stream work and no persist.
        row = current;
      } else {
        // T04 reconciliation: the live stream is updated FIRST, then the
        // tier persists — if the persist fails the retry re-runs a now
        // no-op-equivalent update rather than leaving a persisted tier the
        // stream never received.
        await this.reconcileMessagingTier(name, messagingTier);
        row = await this.repository.updateMessagingTier(name, messagingTier);
        if (!row) {
          throw new NotFoundException(`Tenant '${name}' not found`);
        }
      }
    }

    const items = await this.findNamespacesByTenant(row!.name);
    this.logger.log(`Updated tenant '${name}'`);
    return this.mapRowToDetail(row!, items);
  }

  /**
   * Applies a tier change to the live `INGRESS-<TENANT>` stream (T04 of
   * `manual-loops/messaging/tenant-messaging-tiers.md`, decision 4).
   *
   * - Stream genuinely absent (broker error 10059): nothing to reconcile —
   *   the tier persists and creation applies it. Any OTHER `streams.info`
   *   failure (connection, timeout, auth) RETHROWS so the tier is NOT
   *   persisted under a false "absent" belief — for an existing stream,
   *   creation never re-applies limits (decision 2), so persisting on a
   *   transport error would drift record and stream until the next change.
   * - Shrink guard: under `retention: limits`, lowering `max_bytes` below
   *   the stream's CURRENT bytes discards messages (oldest first). The
   *   platform refuses that with 409 — no force flag in v1. NOTE: `max_age`
   *   shrink is DELIBERATELY unguarded per decision 4's bytes-only
   *   criterion — a downgrade that passes the bytes guard still expires
   *   messages older than the new retention the moment the update lands.
   * - The update carries the full existing config with only the four tier
   *   limit fields overridden, so subjects/retention/etc. never drift here.
   * - INTERIM (T02→T05): with the dev ceilings unset, a live GROW in dev
   *   requests limits the 2 GiB single-node account cannot grant; the broker
   *   rejection maps to 409 below with the broker's reason.
   */
  private async reconcileMessagingTier(
    name: string,
    messagingTier: TenantTier
  ): Promise<void> {
    const streamName = getTenantStreamName(name);
    const target = clampTenantStreamLimits(
      TENANT_TIER_LIMITS[messagingTier],
      readMessagingCeilingsFromEnv()
    );

    let info;
    try {
      info = await this.jsm.streams.info(streamName);
    } catch (err) {
      if (!isStreamNotFoundError(err)) {
        throw err;
      }
      this.logger.log(
        `No live stream ${streamName} to reconcile; ` +
          `tier '${messagingTier}' will apply at creation`
      );
      return;
    }

    if (target.max_bytes < info.state.bytes) {
      throw new ConflictException(
        `Refusing messaging tier change for '${name}': the '${messagingTier}' ` +
          `tier allows ${target.max_bytes} bytes but the stream currently ` +
          `holds ${info.state.bytes} bytes — shrinking would discard ` +
          `messages. Drain or expire the stream first.`
      );
    }

    try {
      await this.jsm.streams.update(streamName, {
        ...info.config,
        max_age: target.max_age,
        max_bytes: target.max_bytes,
        max_msg_size: target.max_msg_size,
        num_replicas: target.num_replicas,
      });
    } catch (err) {
      // Broker refusals (account capacity, replicas on a single node) are a
      // conflict with cluster state, not a server bug — surface the reason
      // instead of a generic 500. The tier is NOT persisted.
      this.logger.error(
        `Broker rejected tier update for ${streamName}: ${String(err)}`
      );
      throw new ConflictException(
        `Cannot apply messaging tier '${messagingTier}' to '${name}': the ` +
          `broker rejected the stream update (${err instanceof Error ? err.message : String(err)})`
      );
    }
    this.logger.log(
      `Reconciled ${streamName} to tier '${messagingTier}' ` +
        `(max_bytes=${target.max_bytes}, max_age=${target.max_age}, ` +
        `num_replicas=${target.num_replicas})`
    );
  }

  /**
   * Tier-aware delete (both branches always cascade-delete the tenant
   * namespace, which is the deployment scope for Knative Services and
   * scheduled K8s Jobs regardless of tier):
   *  - **Shared**: in parallel, drops the tenant database + role on the
   *    `postgres-shared` cluster (`DROP DATABASE ... WITH (FORCE)` terminates
   *    lingering connections) and requests namespace deletion. The DB+role
   *    drop is required because the logical database lives outside the
   *    tenant namespace.
   *  - **Dedicated**: requests namespace deletion; the cascade tears down the
   *    per-tenant Postgres + TimescaleDB StatefulSets and PVCs that own the
   *    data.
   *
   * The platform DB row is removed only after infrastructure cleanup, so a
   * partial failure leaves the row visible (`provisioning_status` unchanged)
   * and the caller can retry the DELETE idempotently.
   *
   * **Provisioning race protection (added 2026-04-28):** when the row is
   * currently `provisioning_status: 'provisioning'`, an in-flight handler
   * is racing this DELETE. Allowing the cascade would leak K8s/postgres
   * resources (the executor's mid-flight `pg.provision` lands AFTER the
   * `deprovisionShared` here, recreating the tenant DB outside any
   * namespace) AND leave the JetStream message in `Outstanding Acks`
   * indefinitely — exactly the failure mode that produced the
   * "stuck pending" zombie messages observed in the RCA. We refuse the
   * delete with HTTP 409 + `Retry-After: 10`; the consumer terminates
   * the in-flight provision (success → `ready`, exhaustion → `failed`)
   * within at most `TENANT_PROVISION_MAX_DELIVER * worst_phase_duration`
   * (≈ 30 s for shared, ≈ 90 s for dedicated). The caller retries
   * idempotently — no operator intervention required.
   */
  async deleteTenant(name: string): Promise<void> {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundException(`Tenant '${name}' not found`);
    }

    if (row.provisioning_status === ProvisioningStatus.Provisioning) {
      // 409 Conflict + Retry-After header so HTTP clients (and our own
      // e2e cleanup) implement the "wait for the row to settle" contract
      // automatically. We deliberately do NOT block here — that would
      // pin a Fastify worker for up to a couple of minutes during
      // dedicated-tier provisioning and starve the rest of the API.
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          error: "Conflict",
          message: `Tenant '${name}' is currently provisioning; retry the delete after the provisioning_status flips to 'ready' or 'failed'.`,
          provisioningStatus: row.provisioning_status,
        },
        HttpStatus.CONFLICT
        // Note: setting headers on the response itself is the
        // controller's responsibility; this body shape includes
        // `provisioningStatus` so callers can decide how long to wait.
      );
    }

    const sharedDeprovision: Promise<unknown> | null =
      row.tier === TenantDatabaseTier.Shared
        ? this.provisioner.deprovisionShared(row.name)
        : null;

    const items = await this.findNamespacesByTenant(name);
    const len = items.length;
    const cleanup: Promise<unknown>[] = new Array(
      len + (sharedDeprovision ? 1 : 0)
    );
    for (let i = 0; i < len; i++) {
      const nsName = items[i]!.metadata!.name!;
      cleanup[i] = this.k8sApi
        .deleteNamespace({ name: nsName })
        .then(() =>
          this.logger.log(
            `Deleted namespace ${nsName} (cascades K8s resources)`
          )
        );
    }
    if (sharedDeprovision) {
      cleanup[len] = sharedDeprovision;
    }
    await Promise.all(cleanup);

    const deleted = await this.repository.deleteByName(name);
    if (!deleted) {
      this.logger.warn(
        `Tenant '${name}' was not found in database after infrastructure cleanup`
      );
    }
    this.logger.log(`Deleted tenant '${name}' from database`);

    // Best-effort fan-out so every long-lived service replica that
    // caches a per-tenant Postgres pool can evict it. Subscribers
    // self-heal on misses (see TenantConnectionManager.verifyConnectivity),
    // so we deliberately do NOT await or throw on publish failure.
    this.deletionPublisher.publishTenantDeleted({
      tenantId: row.id,
      name: row.name,
      tier: row.tier,
    });
  }

  private async buildDetail(row: ITenantRow): Promise<ITenantDetail> {
    const items = await this.findNamespacesByTenant(row.name);
    return this.mapRowToDetail(row, items);
  }

  private mapRowToDetail(
    row: ITenantRow,
    items: k8s.V1Namespace[]
  ): ITenantDetail {
    return {
      id: row.id,
      name: row.name,
      tier: row.tier,
      messagingTier: row.messaging_tier,
      configuration: row.configuration,
      namespaces: this.mapNamespacesToStatuses(items),
      ...databaseHost(row.name, this.environment, row.tier),
      provisioningStatus: row.provisioning_status,
      provisioningError: row.provisioning_error,
      provisioningStartedAt: row.provisioning_started_at,
      provisioningCompletedAt: row.provisioning_completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapNamespacesToStatuses(
    items: k8s.V1Namespace[]
  ): INamespaceStatus[] {
    const len = items.length;
    const out: INamespaceStatus[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const ns = items[i]!;
      out[i] = {
        name: ns.metadata!.name!,
        environment: ns.metadata!.labels![LABEL_ENVIRONMENT] as Environment,
        phase: ns.status?.phase ?? "Unknown",
      };
    }
    return out;
  }

  private async findNamespacesByTenant(
    tenant: string
  ): Promise<k8s.V1Namespace[]> {
    const response = await this.k8sApi.listNamespace({
      labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE},${LABEL_TENANT}=${tenant},${LABEL_ENVIRONMENT}=${this.environment}`,
    });
    return response.items;
  }
}
