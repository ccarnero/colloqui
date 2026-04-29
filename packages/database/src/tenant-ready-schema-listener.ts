import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import {
  TENANT_READY_SUBJECT,
  isTenantReadyMessageV1,
} from "@yoizen/shared";
import { NATS_CONNECTION } from "./nats-provider";
import { TenantConnectionManager } from "./tenant-connection-manager";

/**
 * Generic NestJS provider that **proactively** runs per-tenant schema
 * DDL (registered via `TenantConnectionManager.setSchema` /
 * `setSchemaInitializer`) when `tenant-service` publishes
 * `platform.tenant.ready`.
 *
 * Why this is needed: `TenantConnectionManager.ensureSchema(tenantId)`
 * is internally idempotent and deduped via the `schemaKey` set, so it
 * already runs DDL on the first synchronous request for a tenant. But
 * that lazy path makes the *first* HTTP request for a freshly-provisioned
 * tenant pay the DDL cost — visible as a 500 from `relation "..." does
 * not exist` in components like scheduler-service whose cron tick races
 * the e2e test's first POST. Subscribing to `platform.tenant.ready`
 * lets the service warm the schema as soon as provisioning succeeds,
 * before any client request arrives.
 *
 * Mirrors {@link TenantDeletionEvictionListener} exactly:
 *  - Same transport (Core NATS, no JetStream durability).
 *  - Same SLA: a missed message is harmless because `ensureSchema`
 *    still runs lazily on first access.
 *  - Same subclass support: the constructor takes the concrete
 *    {@link TenantConnectionManager} provider token.
 *
 * Performance: per-message work is one JSON parse + one
 * `ensureSchema(name)` call. `ensureSchema` itself is O(1) when the
 * tenant is already initialized (single `Set.has`) and O(K) only on
 * first run for the tenant where K is the number of registered DDL
 * statements. Concurrent deliveries for the same tenant are coalesced
 * by `pendingSchemaInit` inside the manager, so duplicate
 * `platform.tenant.ready` messages cost a single DDL run total.
 */
@Injectable()
export class TenantReadySchemaListener
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TenantReadySchemaListener.name);
  private subscription: Subscription | null = null;
  private consumeTask: Promise<void> | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    const sub = this.nc.subscribe(TENANT_READY_SUBJECT);
    this.subscription = sub;
    this.consumeTask = this.consume(sub);
    this.logger.log(
      `Subscribed to ${TENANT_READY_SUBJECT} for proactive per-tenant schema warm-up`,
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
        `Subscription to ${TENANT_READY_SUBJECT} ended: ${detail}`,
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
        `Dropping malformed ${TENANT_READY_SUBJECT} payload (invalid JSON)`,
      );
      return;
    }
    if (!isTenantReadyMessageV1(parsed)) {
      this.logger.warn(
        `Dropping ${TENANT_READY_SUBJECT} payload with unrecognized shape`,
      );
      return;
    }
    try {
      // `ensureSchema` is the single-source-of-truth for per-tenant DDL
      // bootstrap. We pass the tenant **name** (not id) because that's
      // what `TenantConnectionManager` keys its catalog lookup and
      // pool/schema maps on.
      await this.tenantConnections.ensureSchema(parsed.name);
      this.logger.log(
        `Pre-warmed schema for tenant '${parsed.name}' on ${TENANT_READY_SUBJECT}`,
      );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      // Non-fatal — the lazy `ensureSchema` path on first request will
      // retry once a real query arrives. We DON'T evict here because
      // a failed pre-warm doesn't mean the pool is poisoned, only that
      // the DDL didn't go through this round.
      this.logger.warn(
        `ensureSchema('${parsed.name}') failed during ready pre-warm; lazy path will retry on first request: ${detail}`,
      );
    }
  }
}
