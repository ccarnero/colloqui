import "../setup-env";

import {
  type DynamicModule,
  Module,
  type ModuleMetadata,
  type Provider,
  ValidationPipe,
} from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { NatsConnection, Subscription } from "nats";

/**
 * Shared harness for the integration suites.
 *
 * These suites import a SINGLE feature module (`JobsModule`,
 * `AgentsModule`, `ConfigFilesModule`) instead of `AppModule`, so the tokens
 * that `ProvidersModule` publishes globally in production (`NatsPublisher`,
 * `LAZY_NATS`, `YoizenclawTenantConnectionManager`) are simply absent from the
 * graph — `.overrideProvider(...)` cannot supply them, it only REPLACES
 * providers Nest already found. They are injected here through a global
 * doubles module instead; the repository tokens, which the feature modules DO
 * declare, go through `.overrideProvider(...)`.
 *
 * The doubles below are deliberately integration-local rather than imported
 * from `test/e2e/setup.ts`: that module imports `testcontainers` and `postgres`
 * at the top level, and pulling it in here would drag a Docker dependency into
 * a suite whose whole point is not needing one.
 */

@Module({})
class IntegrationDoublesModule {
  static forRoot(providers: Provider[]): DynamicModule {
    return {
      module: IntegrationDoublesModule,
      global: true,
      providers,
      exports: providers.map((provider) =>
        typeof provider === "object" && "provide" in provider
          ? provider.provide
          : provider
      ),
    };
  }
}

/**
 * NATS subscription double that stays open until `unsubscribe()`.
 *
 * `JobExecutionStatusConsumer.onModuleInit` iterates its subscriptions; an
 * iterator that completes immediately would make the consumer look like it had
 * lost the broker. Mirrors the e2e harness double.
 */
function createDoubleSubscription(): Subscription {
  let release: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    unsubscribe: (): void => {
      release();
    },
    async *[Symbol.asyncIterator]() {
      await closed;
    },
  } as unknown as Subscription;
}

/**
 * Double for `LazyNatsConnection`.
 *
 * `request()` throws instead of returning a canned reply: no integration test
 * exercises the request/reply runtime path (`AgentsRuntimeService`), and a
 * fabricated response would let such a test pass against a lie.
 */
export function createIntegrationLazyNats(): Record<string, unknown> {
  const connection = {
    subscribe: (): Subscription => createDoubleSubscription(),
    publish: (): void => {},
    request: (): never => {
      throw new Error(
        "createIntegrationLazyNats: request/reply is not doubled — a test reached the runtime NATS path, wire an explicit double for it"
      );
    },
    close: async (): Promise<void> => {},
  } as unknown as NatsConnection;

  return {
    getConnection: async (): Promise<NatsConnection> => connection,
    close: async (): Promise<void> => {},
  };
}

/**
 * Double for `YoizenclawTenantConnectionManager`.
 *
 * Only `SystemVariablesService` (pulled in by `AgentsModule`) still injects it;
 * every repository the suites touch is replaced at its own token, so no test
 * path reaches a SQL connection. Handing back a fake `sql` object would repeat
 * the mistake this harness replaces, so the getters throw.
 */
export function createIntegrationTenantConnectionManager(): Record<
  string,
  unknown
> {
  const unavailable = (): never => {
    throw new Error(
      "createIntegrationTenantConnectionManager: no SQL connection in integration runs — override the repository token for this module instead"
    );
  };

  return {
    getConnection: unavailable,
    ensureSchema: unavailable,
    getKnownTenantIds: (): string[] => [],
    probeFirstPool: async (): Promise<boolean> => false,
    evictTenant: async (): Promise<void> => {},
    onModuleDestroy: async (): Promise<void> => {},
  };
}

export interface IIntegrationAppOptions {
  /** Feature module(s) under test. */
  imports: NonNullable<ModuleMetadata["imports"]>;
  /** Tokens the feature module does NOT declare (globals in production). */
  globals: Provider[];
  /** Tokens the feature module DOES declare — repository providers. */
  overrides?: Array<{ token: unknown; value: unknown }>;
}

/**
 * Builds the app the way production does: FastifyAdapter (not Express) plus the
 * `ValidationPipe` configured in `packages/observability/src/bootstrap-fastify.ts`
 * (`whitelist` / `forbidNonWhitelisted` / `transform` /
 * `enableImplicitConversion`). Without it the suites' 400 assertions measured
 * nothing.
 */
export async function createIntegrationApp(
  options: IIntegrationAppOptions
): Promise<NestFastifyApplication> {
  const builder = Test.createTestingModule({
    imports: [
      IntegrationDoublesModule.forRoot(options.globals),
      ...options.imports,
    ],
  });

  for (const { token, value } of options.overrides ?? []) {
    builder.overrideProvider(token).useValue(value);
  }

  const module = await builder.compile();

  const app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter()
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
