import type { Type } from "@nestjs/common";
import type { StorageEngine } from "./engine";

/**
 * Selects a NestJS module class based on the active storage engine.
 *
 * @param opts - Engine and module classes for each backend.
 * @returns The module class to import.
 */
export function selectEngineModule<P extends Type<unknown>, M extends Type<unknown>>(
  opts: {
    readonly engine: StorageEngine;
    readonly postgres: P;
    readonly mongo: M;
  },
): P | M {
  return opts.engine === "postgres" ? opts.postgres : opts.mongo;
}
