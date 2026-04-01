import {
  Global,
  Module,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
  type DynamicModule,
} from "@nestjs/common";
import type { FactoryProvider } from "@nestjs/common";
import postgres from "postgres";
import type { Sql } from "./types";
import { requireEnv } from "./require-env";

export const POSTGRES_SQL = "POSTGRES_SQL";

export interface PostgresPoolOptions {
  /** Default host when POSTGRES_HOST is not set */
  defaultHost?: string;
  /** Max pool connections (default: 10) */
  max?: number;
  /** Idle timeout in seconds (default: 20) */
  idleTimeout?: number;
  /** Connect timeout in seconds (default: 10) */
  connectTimeout?: number;
  /** Enable prepared statements (default: false) */
  prepare?: boolean;
}

export interface PostgresModuleOptions extends PostgresPoolOptions {
  /** Raw SQL to execute on module init (DDL, migrations, etc.) */
  schemaSql?: string[];
}

/**
 * Creates a NestJS `FactoryProvider` for a postgres.js connection pool.
 * Reads standard env vars: POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB,
 * POSTGRES_USER, POSTGRES_PASSWORD.
 */
export function createPostgresProvider(
  options: PostgresPoolOptions = {},
): FactoryProvider<Sql> {
  const {
    defaultHost = "localhost",
    max = 10,
    idleTimeout = 20,
    connectTimeout = 10,
    prepare = false,
  } = options;

  return {
    provide: POSTGRES_SQL,
    useFactory: (): Sql => {
      const host = process.env.POSTGRES_HOST ?? defaultHost;
      const port = Number(process.env.POSTGRES_PORT) || 5432;
      const database = process.env.POSTGRES_DB ?? "yoizen";
      const username = process.env.POSTGRES_USER ?? "yoizen";
      const password = requireEnv("POSTGRES_PASSWORD");

      return postgres({
        host,
        port,
        database,
        username,
        password,
        max,
        idle_timeout: idleTimeout,
        connect_timeout: connectTimeout,
        prepare,
      });
    },
  };
}

class SchemaInitializer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchemaInitializer.name);

  constructor(
    private readonly sql: Sql,
    private readonly statements: string[],
  ) {}

  async onModuleInit(): Promise<void> {
    for (const statement of this.statements) {
      try {
        await this.sql.unsafe(statement);
      } catch (err) {
        this.logger.error("Schema init failed", err);
      }
    }
    this.logger.log("Schema initialization complete");
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end();
  }
}

/**
 * Creates a `@Global()` NestJS module that provides a postgres.js
 * pool and optionally runs DDL on startup.
 *
 * @example
 * ```ts
 * PostgresModule.register({
 *   defaultHost: "postgres.support-services-dev.svc.cluster.local",
 *   schemaSql: [SCHEMA_SQL, MIGRATION_SQL],
 * })
 * ```
 */
@Global()
@Module({})
export class PostgresModule {
  static register(options: PostgresModuleOptions = {}): DynamicModule {
    const { schemaSql = [], ...poolOptions } = options;
    const sqlProvider = createPostgresProvider(poolOptions);

    const providers: FactoryProvider[] = [sqlProvider];

    if (schemaSql.length > 0) {
      providers.push({
        provide: "SCHEMA_INITIALIZER",
        useFactory: (sql: Sql) =>
          new SchemaInitializer(sql, schemaSql),
        inject: [POSTGRES_SQL],
      });
    }

    return {
      module: PostgresModule,
      global: true,
      providers,
      exports: [sqlProvider],
    };
  }
}
