import type { RegisterServiceDto, ServiceEnvVars } from "./services.dto";

export const SERVICES_REPOSITORY = Symbol("SERVICES_REPOSITORY");

/** Raw row from `registered_services` (subset used by ServicesService). */
export type IRegisteredServiceRow = Record<string, unknown>;

/** Options for inserting a registered service row. */
export interface IInsertRegisteredServiceOptions {
  id: string;
  tenantId: string;
  dto: RegisterServiceDto;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: ServiceEnvVars;
  ksvcName: string;
  ns: string;
}

/** Options for updating a registered service row. */
export interface IUpdateRegisteredServiceOptions {
  id: string;
  tenantId: string;
  image: string;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: ServiceEnvVars;
}

export interface IServicesRepository {
  findIdByTenantAndName(
    tenantId: string,
    name: string
  ): Promise<IRegisteredServiceRow[]>;
  insertRegisteredService(
    options: IInsertRegisteredServiceOptions
  ): Promise<IRegisteredServiceRow[]>;
  listByTenant(tenantId: string): Promise<IRegisteredServiceRow[]>;
  findByIdAndTenant(
    id: string,
    tenantId: string
  ): Promise<IRegisteredServiceRow[]>;
  updateRegisteredService(
    options: IUpdateRegisteredServiceOptions
  ): Promise<IRegisteredServiceRow[]>;
  deleteById(id: string): Promise<void>;
  selectKnativeMetaForRevision(
    id: string,
    tenantId: string
  ): Promise<IRegisteredServiceRow[]>;
}
