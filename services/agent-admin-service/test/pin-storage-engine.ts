/**
 * Pins the DI storage engine to `postgres` for the whole `bun test` process.
 *
 * Why this exists
 * ---------------
 * The engine is captured at MODULE IMPORT time, not at DI-resolution time:
 * `src/providers/providers.module.ts` evaluates `agentAdminServiceConfig.dbEngine`
 * in a top-level `const`, and `agents/jobs/config-files/mcp-servers.module.ts`
 * evaluate it inside the `@Module({ providers: [...] })` decorator argument.
 * `bun test` runs every spec file in ONE process with ONE module registry, so
 * whichever spec imports a `*.module.ts` first freezes the engine for all the
 * others.
 *
 * The e2e suites (`test/e2e/`) drive the real app against a Postgres
 * testcontainer and therefore need the Postgres repositories. The unit and
 * integration suites set `STORAGE_ENGINE=mongo` via `test/setup-env.ts`. Left
 * to file ordering, the e2e suites lose the race (bun loads `test/integration`
 * before `test/e2e`) and end up with Mongo repositories talking to a Postgres
 * pool.
 *
 * How it works
 * ------------
 * Preloads run before ANY test file, so importing the module graph here — with
 * `STORAGE_ENGINE=postgres` in place — freezes every engine-sensitive binding
 * to Postgres regardless of which spec bun loads first. The env var is then
 * restored to its original value so RUN-time readers of the lazy
 * `agentAdminServiceConfig.dbEngine` getter (`RuntimeService.getStatus`, the
 * `HealthController` debug log) keep seeing what `test/setup-env.ts` sets.
 *
 * Wired through `bunfig.toml` so a bare `bun test` gets it too (same reason
 * `services/api-gateway/bunfig.toml` exists), and imported directly by
 * `test/e2e/setup.ts` so a single-file e2e run outside this cwd still works.
 * Both entry points are idempotent — the second import is a registry hit.
 */

/** Config loaders must succeed while the module graph is imported below. */
process.env.MONGO_PASSWORD ??= process.env.POSTGRES_PASSWORD ?? "test";
process.env.POSTGRES_PASSWORD ??= "test";

const previousStorageEngine = process.env.STORAGE_ENGINE;

process.env.STORAGE_ENGINE = "postgres";

/**
 * `require` (synchronous) on purpose — a top-level `await import()` would let
 * the importing module's body continue before the bindings are frozen.
 * `test/preload-env.ts` uses the same CJS-interop escape hatch.
 */
require("../src/app.module");

if (previousStorageEngine === undefined) {
  delete process.env.STORAGE_ENGINE;
} else {
  process.env.STORAGE_ENGINE = previousStorageEngine;
}
