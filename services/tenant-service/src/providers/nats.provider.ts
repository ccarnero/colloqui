import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type FactoryProvider,
} from "@nestjs/common";
import {
  connect,
  DiscardPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from "nats";

export const NATS_CONNECTION = "NATS_CONNECTION";

export type TenantTier = "free" | "pro" | "enterprise";

export const STREAM_LIMITS: Record<
  TenantTier,
  { maxBytes: number; maxAgeDays: number }
> = {
  free: { maxBytes: 1_000_000_000, maxAgeDays: 7 },
  pro: { maxBytes: 5_000_000_000, maxAgeDays: 14 },
  enterprise: { maxBytes: 20_000_000_000, maxAgeDays: 30 },
};

/** Nanoseconds per millisecond. */
const NS_PER_MS = 1_000_000n;
/** Milliseconds per day. */
const MS_PER_DAY = 86_400_000;

/**
 * ACL configuration for a tenant's NATS account.
 * These rules enforce per-tenant isolation per wdocs/05.
 */
export interface NatsAclConfig {
  tenantId: string;
  publishAllow: string[];
  subscribeAllow: string[];
  crossTenantDeny: string[];
}

export interface TenantNatsConnection {
  jetstreamManager(): Promise<JetStreamManager>;
  jetstream(): JetStreamClient;
  close(): Promise<void>;
}

// Delay the NATS handshake until tenant provisioning needs it so the HTTP
// server can start even when NATS is temporarily unavailable.
class LazyNatsConnection implements TenantNatsConnection {
  private connection?: NatsConnection;
  private connectionPromise?: Promise<NatsConnection>;

  constructor(
    private readonly servers: string,
    private readonly timeoutMs = NATS_CONNECT_TIMEOUT_MS,
    private readonly maxReconnectAttempts =
      NATS_MAX_RECONNECT_ATTEMPTS,
  ) {}

  async jetstreamManager(): Promise<JetStreamManager> {
    const connection = await this.getConnection();
    return connection.jetstreamManager();
  }

  jetstream(): JetStreamClient {
    if (!this.connection) {
      throw new Error(
        "NATS connection is not ready yet.",
      );
    }

    return this.connection.jetstream();
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    this.connectionPromise = undefined;

    if (!connection) {
      return;
    }

    await connection.close();
  }

  private async getConnection(): Promise<NatsConnection> {
    if (this.connection) {
      return this.connection;
    }

    if (!this.connectionPromise) {
      this.connectionPromise = connect({
        servers: this.servers,
        timeout: this.timeoutMs,
        maxReconnectAttempts: this.maxReconnectAttempts,
      })
        .then((connection) => {
          this.connection = connection;
          return connection;
        })
        .catch((error: unknown) => {
          this.connectionPromise = undefined;
          throw error;
        });
    }

    return this.connectionPromise;
  }
}

@Injectable()
export class NatsTenantProvisioner {
  private readonly logger = new Logger(NatsTenantProvisioner.name);

  constructor(
    @Inject(NATS_CONNECTION)
    private readonly nc: TenantNatsConnection,
  ) {}

  /**
   * Creates a NATS account scope for the tenant.
   * NATS accounts are managed at the server config level,
   * so this validates the tenant's stream doesn't already
   * exist and marks the account as ready for provisioning.
   */
  async createAccount(tenantId: string): Promise<void> {
    const jsm = await this.nc.jetstreamManager();
    const streamName = `INGRESS-${tenantId}`;

    try {
      await jsm.streams.info(streamName);
      this.logger.warn(
        `Account for tenant '${tenantId}' already exists`,
      );
      return;
    } catch (err: unknown) {
      // Expected: stream not found means account is new
      const natsErr = err as { code?: number };
      if (natsErr.code !== 404) {
        throw err;
      }
    }

    this.logger.log(`NATS account '${tenantId}' validated`);
  }

  /**
   * Creates a JetStream stream for the tenant.
   * Stream name: INGRESS-{tenantId}
   * Subject filter: evt.{tenantId}.>
   * Limits are tier-based per wdocs/01.
   */
  async createStream(
    tenantId: string,
    tier: TenantTier,
  ): Promise<void> {
    const limits = STREAM_LIMITS[tier];
    const streamName = `INGRESS-${tenantId}`;
    const jsm = await this.nc.jetstreamManager();

    const maxAgeNs =
      BigInt(limits.maxAgeDays * MS_PER_DAY) * NS_PER_MS;

    await jsm.streams.add({
      name: streamName,
      subjects: [`evt.${tenantId}.>`],
      storage: StorageType.File,
      discard: DiscardPolicy.Old,
      max_bytes: limits.maxBytes,
      max_age: Number(maxAgeNs),
      max_msg_size: 1_048_576, // 1 MB
      duplicate_window: 120_000_000_000, // 2 min in ns
      num_replicas: 1,
    });

    this.logger.log(
      `Created stream '${streamName}' (tier: ${tier}, ` +
        `maxBytes: ${limits.maxBytes}, ` +
        `maxAge: ${limits.maxAgeDays}d)`,
    );
  }

  /**
   * Creates an Object Store bucket for the tenant.
   * Bucket name: PAYLOAD-{tenantId}
   * TTL is aligned to the stream retention per wdocs/04.
   */
  async createObjectStore(
    tenantId: string,
    tier: TenantTier,
  ): Promise<void> {
    const limits = STREAM_LIMITS[tier];
    const bucketName = `PAYLOAD-${tenantId}`;
    const ttlNs =
      BigInt(limits.maxAgeDays * MS_PER_DAY) * NS_PER_MS;

    await this.nc.jetstreamManager();
    const js = this.nc.jetstream();
    await js.views.os(bucketName, {
      description: `Payloads for tenant ${tenantId}`,
      ttl: Number(ttlNs),
      max_bytes: 5_000_000_000, // 5 GB
      replicas: 1,
    });

    this.logger.log(
      `Created object store '${bucketName}' ` +
        `(ttl: ${limits.maxAgeDays}d)`,
    );
  }

  /**
   * Creates ACL rules for the tenant's NATS account
   * per wdocs/05 security model.
   *
   * Publish: only authorized services on evt.{tenant}.>
   * Subscribe: only yoizenclaw-runtime for that tenant
   * Cross-tenant: DENY all other tenant subjects
   */
  async createACLs(
    tenantId: string,
    authorizedServices: string[],
  ): Promise<NatsAclConfig> {
    const config: NatsAclConfig = {
      tenantId,
      publishAllow: [`evt.${tenantId}.>`],
      subscribeAllow: [`evt.${tenantId}.yoizenclaw.>`],
      crossTenantDeny: [`evt.*.>`],
    };

    // Record authorized services for audit
    const services = authorizedServices.join(", ");
    this.logger.log(
      `Created ACLs for tenant '${tenantId}' ` +
        `(authorized: ${services})`,
    );
    this.logger.debug(`ACL config: ${JSON.stringify(config)}`);

    return config;
  }

  /**
   * Deactivates a tenant's NATS account by deleting
   * the associated stream. Object Store data expires
   * automatically via TTL.
   */
  async deactivateAccount(tenantId: string): Promise<void> {
    const jsm = await this.nc.jetstreamManager();
    const streamName = `INGRESS-${tenantId}`;

    try {
      await jsm.streams.delete(streamName);
      this.logger.log(
        `Deleted stream '${streamName}' ` +
          `for tenant '${tenantId}'`,
      );
    } catch {
      this.logger.warn(
        `Stream '${streamName}' not found ` +
          "during deactivation",
      );
    }

    this.logger.log(
      `Deactivated NATS account for tenant '${tenantId}'`,
    );
  }
}

const NATS_CONNECT_TIMEOUT_MS = 10_000;
const NATS_MAX_RECONNECT_ATTEMPTS = 5;

const natsConnectionProvider: FactoryProvider<TenantNatsConnection> = {
  provide: NATS_CONNECTION,
  useFactory: (): TenantNatsConnection => {
    const servers =
      process.env.NATS_URL ?? "nats://localhost:4222";
    return new LazyNatsConnection(servers);
  },
};

@Global()
@Module({
  providers: [natsConnectionProvider, NatsTenantProvisioner],
  exports: [natsConnectionProvider, NatsTenantProvisioner],
})
export class NatsModule {}
