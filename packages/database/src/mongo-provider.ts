import {
  Global,
  Module,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
  type DynamicModule,
} from "@nestjs/common";
import type { FactoryProvider } from "@nestjs/common";
import { MongoClient } from "mongodb";
import type { IMongoCollectionSchema } from "@yoizen/shared";
import { requireEnv } from "./require-env";
import { applyMongoSchema } from "./mongo-schema-applier";

export const MONGO_CLIENT = "MONGO_CLIENT";

export interface MongoPoolOptions {
  /** Default host when MONGO_HOST is not set */
  defaultHost?: string;
  /** Max pool connections (default: 10) */
  maxPoolSize?: number;
}

/**
 * Shared pool tuning for platform HTTP services (auth, workflow, etc.).
 * O(1) constant — import instead of duplicating `createMongoProvider` options.
 */
export const PLATFORM_MONGO_POOL_OPTIONS: Readonly<MongoPoolOptions> = {
  maxPoolSize: 20,
};

export interface MongoModuleOptions extends MongoPoolOptions {
  /** Collection/index descriptors applied on module init */
  schema?: IMongoCollectionSchema[];
}

function resolveMongoPassword(): string {
  return process.env.MONGO_PASSWORD ?? requireEnv("MONGO_PASSWORD");
}

/**
 * Builds a MongoDB connection URI from env vars.
 * Prefers `MONGO_URI` when set; otherwise composes from host/port/db/credentials.
 */
export function buildMongoUri(options: MongoPoolOptions = {}): string {
  const explicit = process.env.MONGO_URI;
  if (explicit) {
    return explicit;
  }

  const host = process.env.MONGO_HOST ?? options.defaultHost ?? "localhost";
  const port = process.env.MONGO_PORT ?? "27017";
  const database = process.env.MONGO_DB ?? "yoizen";
  const user = process.env.MONGO_USER;

  if (user) {
    const password = resolveMongoPassword();
    const encodedUser = encodeURIComponent(user);
    const encodedPassword = encodeURIComponent(password);
    return `mongodb://${encodedUser}:${encodedPassword}@${host}:${port}/${database}?authSource=admin`;
  }

  return `mongodb://${host}:${port}/${database}`;
}

/**
 * Creates a NestJS `FactoryProvider` for a MongoDB client.
 * Reads standard env vars: MONGO_URI, MONGO_HOST, MONGO_PORT, MONGO_DB,
 * MONGO_USER, MONGO_PASSWORD.
 */
export function createMongoProvider(
  options: MongoPoolOptions = {},
): FactoryProvider<MongoClient> {
  const { maxPoolSize = 10 } = options;

  return {
    provide: MONGO_CLIENT,
    useFactory: (): MongoClient => {
      const uri = buildMongoUri(options);
      return new MongoClient(uri, { maxPoolSize });
    },
  };
}

class SchemaInitializer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchemaInitializer.name);

  constructor(
    private readonly client: MongoClient,
    private readonly schemas: readonly IMongoCollectionSchema[],
  ) {}

  async onModuleInit(): Promise<void> {
    const database = process.env.MONGO_DB ?? "yoizen";
    try {
      const db = this.client.db(database);
      await applyMongoSchema(db, this.schemas);
      this.logger.log("Mongo schema initialization complete");
    } catch (err) {
      this.logger.error("Mongo schema init failed", err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Creates a `@Global()` NestJS module that provides a MongoDB client and
 * optionally applies collection/index descriptors on startup.
 *
 * @example
 * ```ts
 * MongoModule.register({
 *   defaultHost: "mongo.support-services-dev.svc.cluster.local",
 *   schema: PLATFORM_MONGO_SCHEMA,
 * })
 * ```
 */
@Global()
@Module({})
export class MongoModule {
  static register(options: MongoModuleOptions = {}): DynamicModule {
    const { schema = [], ...poolOptions } = options;
    const clientProvider = createMongoProvider(poolOptions);

    const providers: FactoryProvider[] = [clientProvider];

    if (schema.length > 0) {
      providers.push({
        provide: "MONGO_SCHEMA_INITIALIZER",
        useFactory: (client: MongoClient) =>
          new SchemaInitializer(client, schema),
        inject: [MONGO_CLIENT],
      });
    }

    return {
      module: MongoModule,
      global: true,
      providers,
      exports: [clientProvider],
    };
  }
}
