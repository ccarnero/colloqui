import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";

type AuditServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
};

export const auditServiceConfig: AuditServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
};
