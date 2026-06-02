import type { CreateRouteDto } from "./routes.dto";

export const ROUTES_REPOSITORY = Symbol("ROUTES_REPOSITORY");

export type IRouteRow = Record<string, unknown>;
export type IRouteDiscoverySqlRow = Record<string, unknown>;

/** Options for inserting a service route row. */
export interface IInsertRouteOptions {
  id: string;
  serviceId: string;
  dto: CreateRouteDto;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
}

export interface IRoutesRepository {
  findServiceByTenant(
    serviceId: string,
    tenantId: string,
  ): Promise<IRouteRow[]>;
  insertRoute(options: IInsertRouteOptions): Promise<IRouteRow[]>;
  listRoutesForService(serviceId: string): Promise<IRouteRow[]>;
  deleteRoute(
    routeId: string,
    serviceId: string,
  ): Promise<{ count: number }>;
  discoverActiveRoutes(): Promise<IRouteDiscoverySqlRow[]>;
}
