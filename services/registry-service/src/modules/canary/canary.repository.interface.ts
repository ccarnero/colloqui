import type { UpdateCanaryDto } from "./canary.dto";

export const CANARY_REPOSITORY = Symbol("CANARY_REPOSITORY");

export type IRegisteredServiceDbRow = Record<string, unknown>;
export type ICanaryDbRow = Record<string, unknown>;

/** Options for inserting a canary deployment row. */
export interface IInsertCanaryDeploymentOptions {
  id: string;
  serviceId: string;
  stableRevision: string;
  canaryRevision: string;
  percent: number;
}

export interface ICanaryRepository {
  findProgressingCanary(serviceId: string): Promise<Record<string, unknown>[]>;
  insertCanaryDeployment(
    options: IInsertCanaryDeploymentOptions,
  ): Promise<ICanaryDbRow[]>;
  updateCanaryPercent(
    canaryId: string,
    dto: UpdateCanaryDto,
  ): Promise<ICanaryDbRow[]>;
  updateCanaryPromoted(canaryId: string): Promise<ICanaryDbRow[]>;
  updateCanaryRolledBack(canaryId: string): Promise<ICanaryDbRow[]>;
  getLatestCanaryForService(serviceId: string): Promise<ICanaryDbRow[]>;
  findRegisteredService(
    serviceId: string,
    tenantId: string,
  ): Promise<IRegisteredServiceDbRow[]>;
  findActiveCanary(serviceId: string): Promise<ICanaryDbRow[]>;
}
