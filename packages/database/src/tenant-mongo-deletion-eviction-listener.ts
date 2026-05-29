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
import { TenantMongoConnectionManager } from "./tenant-mongo-connection-manager";

/**
 * Evicts per-tenant Mongo client caches on `platform.tenant.deleted`.
 * Mirror of {@link import("./tenant-deletion-eviction-listener").TenantDeletionEvictionListener}.
 */
@Injectable()
export class TenantMongoDeletionEvictionListener
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TenantMongoDeletionEvictionListener.name);
  private subscription: Subscription | null = null;
  private consumeTask: Promise<void> | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    const sub = this.nc.subscribe(TENANT_DELETED_SUBJECT);
    this.subscription = sub;
    this.consumeTask = this.consume(sub);
    this.logger.log(
      `Subscribed to ${TENANT_DELETED_SUBJECT} for per-tenant Mongo eviction`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    const sub = this.subscription;
    this.subscription = null;
    if (sub) {
      try {
        sub.unsubscribe();
      } catch {
        // already closed during shutdown
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
      await this.tenantConnections.evictTenant(parsed.name);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `evictTenant('${parsed.name}') failed; client will be reaped lazily: ${detail}`,
      );
    }
  }
}
