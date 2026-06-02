import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";

type ConnectorAdminConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
};

/** Lazy getters so tests can set `process.env` before first consumer reads config. */
export const connectorAdminConfig: ConnectorAdminConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
};

/** @deprecated Use {@link connectorAdminConfig}. */
export const adapterServiceConfig = connectorAdminConfig;
