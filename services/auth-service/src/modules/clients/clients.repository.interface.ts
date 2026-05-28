export const CLIENTS_REPOSITORY = Symbol("CLIENTS_REPOSITORY");

export interface IClientRow {
  id: string;
  client_id: string;
  name: string;
  scope: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Options for inserting an API client row. */
export interface IInsertClientOptions {
  id: string;
  clientId: string;
  secretHash: string;
  name: string;
  scope: string;
}

export interface IClientsRepository {
  insertClient(options: IInsertClientOptions): Promise<IClientRow[]>;
  listForTenant(tenantScope: string): Promise<Omit<IClientRow, "is_active">[]>;
  listAllActive(): Promise<Omit<IClientRow, "is_active">[]>;
  revokeClient(id: string): Promise<boolean>;
}
