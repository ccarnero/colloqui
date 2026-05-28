/** Storage engine discriminator for bootstrap-level coexistence. */
export type StorageEngine = "postgres" | "mongo";

const VALID_ENGINES: ReadonlySet<string> = new Set(["postgres", "mongo"]);

/**
 * Resolves the active storage engine from environment.
 * `DB_ENGINE` takes precedence over `STORAGE_ENGINE`; default is `postgres`.
 *
 * @param env - Process environment (defaults to `process.env`).
 * @returns The resolved engine.
 */
export function resolveStorageEngine(
  env: NodeJS.ProcessEnv = process.env,
): StorageEngine {
  const raw = env.DB_ENGINE ?? env.STORAGE_ENGINE ?? "postgres";
  if (!VALID_ENGINES.has(raw)) {
    throw new Error(
      `Invalid DB_ENGINE='${raw}'. Expected 'postgres' or 'mongo'.`,
    );
  }
  return raw as StorageEngine;
}
