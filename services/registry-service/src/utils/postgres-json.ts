import type postgres from "postgres";

/**
 * Values passed to {@link postgres.Sql#json} must be `JSONValue`. Plain
 * `Record<string, unknown>` is not assignable; this normalizes via
 * JSON round-trip (same payload Postgres would store).
 */
export function asPostgresJsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value ?? null)) as postgres.JSONValue;
}
