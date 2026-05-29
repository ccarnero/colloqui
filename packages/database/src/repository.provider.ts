import type { InjectionToken, Provider, Type } from "@nestjs/common";
import type { StorageEngine } from "./engine";

/**
 * Registers a repository implementation chosen by storage engine.
 *
 * @param opts - Token, engine, and concrete repository classes.
 * @returns NestJS provider binding the token to the active adapter.
 */
export function createRepositoryProvider<T>(opts: {
  readonly token: InjectionToken;
  readonly engine: StorageEngine;
  readonly postgresClass: Type<T>;
  readonly mongoClass: Type<T>;
}): Provider {
  return {
    provide: opts.token,
    useClass: opts.engine === "postgres" ? opts.postgresClass : opts.mongoClass,
  };
}
