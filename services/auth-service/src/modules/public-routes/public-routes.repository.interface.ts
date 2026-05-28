export const PUBLIC_ROUTES_REPOSITORY = Symbol("PUBLIC_ROUTES_REPOSITORY");

export interface IPublicRouteRow {
  id: string;
  method: string;
  path_pattern: string;
  scope: string;
  environment: string;
  created_at: Date;
}

export interface IPublicRoutesRepository {
  readonly environmentName: string;
  insertRoute(
    id: string,
    method: string,
    pathPattern: string,
    scope: string,
  ): Promise<IPublicRouteRow[]>;
  listForTenant(tenantScope: string): Promise<IPublicRouteRow[]>;
  listAll(): Promise<IPublicRouteRow[]>;
  deleteById(id: string): Promise<{ id: string }[]>;
  loadSyncRows(): Promise<
    Array<{ method: unknown; path_pattern: unknown; scope: unknown }>
  >;
}
