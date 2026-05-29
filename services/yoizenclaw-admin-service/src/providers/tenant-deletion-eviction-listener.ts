import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type {
  TenantConnectionManager,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { YoizenclawTenantConnectionManager } from "./tenant-connection-manager";
import {
  TENANT_DELETED_SUBJECT,
  isTenantDeletedMessageV1,
} from "@yoizen/shared";
import type { NatsConnection, Subscription } from "nats";
import { LAZY_NATS } from "./nats.provider";

interface ILazyNatsHandle {
  getConnection(): Promise<NatsConnection>;
}

const RECONNECT_BACKOFF_MS = [
  1_000,
  2_000,
  5_000,
  10_000,
  30_000,
  60_000,
] as const;

/**
 * Admin-service specific eviction listener that subscribes to
 * `platform.tenant.deleted` over Core NATS and evicts the matching
 * per-tenant pool from {@link YoizenclawTenantConnectionManager}.
 *
 * Why a service-local copy instead of `@yoizen/database`'s
 * {@link import('@yoizen/database').TenantDeletionEvictionListener}:
 * the admin service intentionally lazy-connects to NATS so the HTTP
 * server can start even when the broker is offline (see
 * `LazyNatsConnection`). The shared listener takes a resolved
 * `NATS_CONNECTION`, which would force eager connection at boot and
 * break that contract. This subclass schedules subscription as a
 * background task with bounded backoff so a temporarily-down broker
 * can't crash the pod, while still wiring the eviction the moment
 * the connection becomes available.
 *
 * Performance: O(1) subscribe, O(1) per delivered message + the
 * `evictTenant` Map scan (O(P) cached pools, tens at most). Idempotent
 * across duplicate deliveries; safe under reconnect.
 */
@Injectable()
export class TenantDeletionEvictionListener
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TenantDeletionEvictionListener.name);
  private subscription: Subscription | null = null;
  private startTask: Promise<void> | null = null;
  private stopped = false;

  constructor(
    @Inject(LAZY_NATS) private readonly lazyNats: ILazyNatsHandle,
    @Inject(YoizenclawTenantConnectionManager)
    private readonly tenantConnections:
      | TenantConnectionManager
      | TenantMongoConnectionManager,
  ) {}

  onModuleInit(): void {
    this.startTask = this.startWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    const sub = this.subscription;
    this.subscription = null;
    if (sub) {
      try {
        sub.unsubscribe();
      } catch {
        // already drained — safe to ignore on shutdown
      }
    }
    if (this.startTask) {
      try {
        await this.startTask;
      } catch {
        // background task errors are surfaced via the logger
      }
      this.startTask = null;
    }
  }

  private async startWithRetry(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      try {
        const nc = await this.lazyNats.getConnection();
        const sub = nc.subscribe(TENANT_DELETED_SUBJECT);
        this.subscription = sub;
        this.logger.log(
          `Subscribed to ${TENANT_DELETED_SUBJECT} for per-tenant pool eviction`,
        );
        await this.consume(sub);
        // consume returns when iterator closes (broker disconnect / unsubscribe).
        // If shutdown was requested we exit; otherwise we re-resolve a fresh
        // connection and resubscribe with the same backoff schedule.
        if (this.stopped) return;
        attempt = 0;
        continue;
      } catch (err: unknown) {
        if (this.stopped) return;
        const detail = err instanceof Error ? err.message : String(err);
        const delay =
          RECONNECT_BACKOFF_MS[
            Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)
          ]!;
        this.logger.warn(
          `Subscribe to ${TENANT_DELETED_SUBJECT} failed (attempt ${attempt + 1}); retry in ${delay}ms: ${detail}`,
        );
        attempt += 1;
        await this.sleep(delay);
      }
    }
  }

  private async consume(sub: Subscription): Promise<void> {
    try {
      for await (const msg of sub) {
        await this.handle(msg.data);
      }
    } catch (err: unknown) {
      if (this.stopped) return;
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Subscription to ${TENANT_DELETED_SUBJECT} ended: ${detail}`,
      );
    }
  }

  /**
   * `protected` so unit tests can drive a single payload through the
   * handler without a live NATS subscription.
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
      // See @yoizen/database/src/tenant-deletion-eviction-listener.ts for
      // the rationale: TenantConnectionManager keys every cache (`pools`,
      // `initialized`, `pendingSchemaInit`, `knownTenantIds`, `tierCache`)
      // by tenant SLUG, not platform UUID. Forwarding `parsed.tenantId`
      // (the UUID) makes `evictTenant` a silent no-op, which then pins
      // the schema cache and produces "relation \"...\" does not exist"
      // when a tenant is recreated with the same name.
      await this.tenantConnections.evictTenant(parsed.name);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `evictTenant('${parsed.name}') failed; pool will be reaped lazily by verifyConnectivity self-heal: ${detail}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
