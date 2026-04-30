import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import {
  TENANT_DELETED_SUBJECT,
  isTenantDeletedMessageV1,
} from "@yoizen/shared";
import { NATS_CONNECTION } from "./nats-provider";
import { TenantConnectionManager } from "./tenant-connection-manager";

/**
 * Generic NestJS provider that closes the per-tenant Postgres pool
 * cache held by a {@link TenantConnectionManager} (or any subclass)
 * when `tenant-service` publishes `platform.tenant.deleted`.
 *
 * Why this is needed: API pods cache `postgres.js` connection pools
 * keyed by `host/db/user`. When a tenant is destroyed, the underlying
 * database / role disappear but the pool stays in memory and every
 * subsequent `SELECT 1` from `verifyConnectivity` fails — pinning the
 * pod's `/readyz` to 503 until it is restarted. This listener wires
 * the eviction at the moment the tenant goes away so the pod recovers
 * within milliseconds instead of waiting for the secondary
 * self-healing branch in `verifyConnectivity` to catch up.
 *
 * Subclasses are supported transparently: the constructor takes the
 * concrete provider token (e.g. `AdapterTenantConnectionManager`) so
 * each service wires its own subclass without duplicating subscribe
 * logic.
 *
 * Transport: **Core NATS** (fire-and-forget pub/sub) — see
 * {@link TENANT_DELETED_SUBJECT} for the rationale (fan-out vs the
 * `PLATFORM_TENANTS` Workqueue stream used by provisioning).
 *
 * Performance: subscription consumes one async iterator; per-message
 * cost is one JSON parse + one Map scan inside `evictTenant`
 * (O(P) where P = cached tenant pools, tens at most). Idempotent on
 * duplicate deliveries.
 */
@Injectable()
export class TenantDeletionEvictionListener
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TenantDeletionEvictionListener.name);
  private subscription: Subscription | null = null;
  private consumeTask: Promise<void> | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    const sub = this.nc.subscribe(TENANT_DELETED_SUBJECT);
    this.subscription = sub;
    this.consumeTask = this.consume(sub);
    this.logger.log(
      `Subscribed to ${TENANT_DELETED_SUBJECT} for per-tenant pool eviction`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    const sub = this.subscription;
    this.subscription = null;
    if (sub) {
      try {
        sub.unsubscribe();
      } catch {
        // already closed during shutdown — safe to ignore
      }
    }
    if (this.consumeTask) {
      try {
        await this.consumeTask;
      } catch {
        // iterator errors are surfaced inside consume()
      }
      this.consumeTask = null;
    }
  }

  private async consume(sub: Subscription): Promise<void> {
    try {
      for await (const msg of sub) {
        await this.handle(msg.data);
      }
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Subscription to ${TENANT_DELETED_SUBJECT} ended: ${detail}`,
      );
    }
  }

  /**
   * `protected` (vs private) so subclasses / tests can drive a single
   * message through the handler without standing up a real NATS
   * subscription.
   */
  protected async handle(payload: Uint8Array): Promise<void> {
    const text = new TextDecoder().decode(payload);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.warn(
        `Dropping malformed ${TENANT_DELETED_SUBJECT} payload (invalid JSON)`,
      );
      return;
    }
    if (!isTenantDeletedMessageV1(parsed)) {
      this.logger.warn(
        `Dropping ${TENANT_DELETED_SUBJECT} payload with unrecognized shape`,
      );
      return;
    }
    try {
      // CRITICAL: pass `parsed.name` (the tenant slug), NOT `parsed.tenantId`
      // (the platform DB UUID). Inside TenantConnectionManager every cache
      // key — `pools` (`shared-tenant:<NAME>:...`), `initialized`
      // (`shared-tenant:<NAME>:<db>`), `pendingSchemaInit`, `knownTenantIds`,
      // `tierCache` — is keyed by the tenant NAME, because that's what
      // `tenantPostgresDatabaseName` / `tenantPostgresRoleName` derive from
      // and what every caller (`getEnabledSchedules`, `ensureSchema(...)`)
      // passes through. Calling `evictTenant(uuid)` runs a prefix-scan over
      // `shared-tenant:<uuid>:` which never matches, so eviction silently
      // no-ops — leaving the schemaKey in `initialized` and pinning the
      // stale pool. The next `ensureSchema(name)` then early-returns
      // without running DDL, producing `relation "..." does not exist`
      // the moment a tenant is recreated with the same name (e.g. the
      // e2e `test-shared-tenant` second run).
      await this.tenantConnections.evictTenant(parsed.name);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `evictTenant('${parsed.name}') failed; pool will be reaped lazily by verifyConnectivity self-heal: ${detail}`,
      );
    }
  }
}
