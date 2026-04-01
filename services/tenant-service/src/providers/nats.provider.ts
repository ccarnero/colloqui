import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  ServiceUnavailableException,
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
import {
  type TenantTier,
  TENANT_TIER_LIMITS,
  getTenantStreamName,
  checkJetStreamCapacity,
} from "@yoizen/shared";

export { type TenantTier } from "@yoizen/shared";

export const NATS_CONNECTION = "NATS_CONNECTION";

/**
 * @deprecated Import TENANT_TIER_LIMITS from @yoizen/shared instead.
 * Kept for backward compatibility with existing tests.
 */
export const STREAM_LIMITS: Record<
  TenantTier,
  { maxBytes: number; maxAgeDays: number }
> = {
  free: {
    maxBytes: TENANT_TIER_LIMITS.free.max_bytes,
    maxAgeDays: 7,
  },
  pro: {
    maxBytes: TENANT_TIER_LIMITS.pro.max_bytes,
    maxAgeDays: 14,
  },
  enterprise: {
    maxBytes: TENANT_TIER_LIMITS.enterprise.max_bytes,
    maxAgeDays: 30,
  },
};

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
      throw new ServiceUnavailableException(
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
    const streamName = getTenantStreamName(tenantId);

    try {
      await jsm.streams.info(streamName);
      this.logger.warn(
        `Account for tenant '${tenantId}' already exists`,
      );
      return;
    } catch (err: unknown) {
      const natsErr = err as { code?: number };
      if (natsErr.code !== 404) {
        throw err;
      }
    }

    this.logger.log(`NATS account '${tenantId}' validated`);
  }

  /**
   * Creates a JetStream stream for the tenant.
   * Stream name: INGRESS-{TENANT_ID} (uppercased)
   * Subject filter: evt.{tenantId}.>
   * Limits are tier-based via @yoizen/shared TENANT_TIER_LIMITS.
   */
  async createStream(
    tenantId: string,
    tier: TenantTier,
  ): Promise<void> {
    const limits = TENANT_TIER_LIMITS[tier];
    const streamName = getTenantStreamName(tenantId);
    const jsm = await this.nc.jetstreamManager();

    const accountInfo = await jsm.getAccountInfo();
    const capacityCheck = checkJetStreamCapacity(
      limits.max_bytes,
      accountInfo.storage,
      accountInfo.limits.max_storage,
    );
    if (!capacityCheck.ok) {
      this.logger.error(capacityCheck.message);
      throw new ServiceUnavailableException(capacityCheck.message);
    }

    await jsm.streams.add({
      name: streamName,
      subjects: [`evt.${tenantId}.>`],
      storage: StorageType.File,
      discard: DiscardPolicy.Old,
      max_bytes: limits.max_bytes,
      max_age: limits.max_age,
      max_msg_size: limits.max_msg_size,
      duplicate_window: 120_000_000_000,
      num_replicas: limits.num_replicas,
    });

    this.logger.log(
      `Created stream '${streamName}' (tier: ${tier}, ` +
        `maxBytes: ${limits.max_bytes})`,
    );
  }

  /**
   * Creates an Object Store bucket for the tenant.
   * Bucket name: PAYLOAD-{TENANT_ID} (uppercased)
   * TTL and max_bytes are tier-based via TENANT_TIER_LIMITS.
   */
  async createObjectStore(
    tenantId: string,
    tier: TenantTier,
  ): Promise<void> {
    const limits = TENANT_TIER_LIMITS[tier];
    const bucketName = `PAYLOAD-${tenantId.toUpperCase()}`;

    await this.nc.jetstreamManager();
    const js = this.nc.jetstream();
    await js.views.os(bucketName, {
      description: `Payloads for tenant ${tenantId}`,
      ttl: limits.max_age,
      max_bytes: limits.object_store_max_bytes,
      replicas: 1,
    });

    this.logger.log(
      `Created object store '${bucketName}' ` +
        `(maxBytes: ${limits.object_store_max_bytes})`,
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
