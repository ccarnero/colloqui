import type { Paginated } from "../../core/pagination.js";
import { paginate, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CanaryStatus,
  CreateRouteInput,
  DiscoveredRoute,
  RegisteredService,
  RegisteredServiceDetail,
  RegisterServiceInput,
  ServiceRevision,
  ServiceRoute,
  StartCanaryInput,
  UpdateCanaryInput,
  UpdateServiceInput,
} from "./types.js";

export interface RegistryClientDeps {
  transport: Transport;
}

export interface RegistryCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface RegistryCanaryClient {
  /** `POST /registry/services/:serviceId/canary` — starts a canary deployment. */
  start(
    serviceId: string,
    input: StartCanaryInput,
    opts?: RegistryCallOptions
  ): Promise<CanaryStatus>;
  /** `PATCH /registry/services/:serviceId/canary` — adjusts the traffic split percent. */
  update(
    serviceId: string,
    input: UpdateCanaryInput,
    opts?: RegistryCallOptions
  ): Promise<CanaryStatus>;
  /** `POST /registry/services/:serviceId/canary/promote` — shifts 100% traffic to the canary revision. */
  promote(serviceId: string, opts?: RegistryCallOptions): Promise<CanaryStatus>;
  /** `POST /registry/services/:serviceId/canary/rollback` — reverts 100% traffic to the stable revision. */
  rollback(
    serviceId: string,
    opts?: RegistryCallOptions
  ): Promise<CanaryStatus>;
  /**
   * `GET /registry/services/:serviceId/canary` — returns `null` (HTTP 200)
   * when no canary deployment exists for the service (not a 404).
   */
  getStatus(
    serviceId: string,
    opts?: RegistryCallOptions
  ): Promise<CanaryStatus | null>;
}

export interface RegistryRoutesClient {
  /**
   * `POST /registry/services/:serviceId/routes` — registers a dynamic route.
   * See `types.ts` CAUTION: this feeds the gateway's live dynamic router.
   */
  create(
    serviceId: string,
    input: CreateRouteInput,
    opts?: RegistryCallOptions
  ): Promise<ServiceRoute>;
  /** `GET /registry/services/:serviceId/routes` — bare array, degraded to a single page. */
  list(serviceId: string): Paginated<ServiceRoute>;
  /** `DELETE /registry/services/:serviceId/routes/:routeId`; resolves on 204. */
  remove(
    serviceId: string,
    routeId: string,
    opts?: RegistryCallOptions
  ): Promise<void>;
}

export interface RegistryServicesClient {
  /** `POST /registry/services` — registers a service and deploys its Knative backing. */
  create(
    input: RegisterServiceInput,
    opts?: RegistryCallOptions
  ): Promise<RegisteredService>;
  /** `GET /registry/services` — bare array, degraded to a single page. */
  list(): Paginated<RegisteredService>;
  /** `GET /registry/services/:id` — includes live Knative status when deployed. */
  get(id: string, opts?: RegistryCallOptions): Promise<RegisteredServiceDetail>;
  /** `PATCH /registry/services/:id`. */
  update(
    id: string,
    input: UpdateServiceInput,
    opts?: RegistryCallOptions
  ): Promise<RegisteredService>;
  /** `DELETE /registry/services/:id`; resolves on 204. */
  remove(id: string, opts?: RegistryCallOptions): Promise<void>;
  /** `GET /registry/services/:id/revisions` — bare array, degraded to a single page. */
  listRevisions(id: string): Paginated<ServiceRevision>;
}

export interface RegistryClient {
  services: RegistryServicesClient;
  canary: RegistryCanaryClient;
  routes: RegistryRoutesClient;
  /**
   * `GET /registry/routes` — root discovery, the exact feed the gateway's
   * dynamic router polls every 15s. Read-only introspection escape hatch;
   * see `types.ts` CAUTION before relying on it operationally.
   */
  discoverRoutes(): Paginated<DiscoveredRoute>;
}

/**
 * Creates the `registry` namespace client. Follows the `workflows` reference
 * implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md "Resource
 * clients".
 */
export function createRegistryClient({
  transport,
}: RegistryClientDeps): RegistryClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function servicesCreate(
    input: RegisterServiceInput,
    opts: RegistryCallOptions = {}
  ): Promise<RegisteredService> {
    const { body } = await transport.request<RegisteredService>({
      path: "/registry/services",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function servicesList(): Paginated<RegisteredService> {
    return paginate<RegisteredService>(async () => {
      const { body } = await transport.request<RegisteredService[]>({
        path: "/registry/services",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function servicesGet(
    id: string,
    opts: RegistryCallOptions = {}
  ): Promise<RegisteredServiceDetail> {
    const { body } = await transport.request<RegisteredServiceDetail>({
      path: `/registry/services/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function servicesUpdate(
    id: string,
    input: UpdateServiceInput,
    opts: RegistryCallOptions = {}
  ): Promise<RegisteredService> {
    const { body } = await transport.request<RegisteredService>({
      path: `/registry/services/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function servicesRemove(
    id: string,
    opts: RegistryCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/registry/services/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  function servicesListRevisions(id: string): Paginated<ServiceRevision> {
    return paginate<ServiceRevision>(async () => {
      const { body } = await transport.request<ServiceRevision[]>({
        path: `/registry/services/${encodePath(id)}/revisions`,
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function canaryStart(
    serviceId: string,
    input: StartCanaryInput,
    opts: RegistryCallOptions = {}
  ): Promise<CanaryStatus> {
    const { body } = await transport.request<CanaryStatus>({
      path: `/registry/services/${encodePath(serviceId)}/canary`,
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function canaryUpdate(
    serviceId: string,
    input: UpdateCanaryInput,
    opts: RegistryCallOptions = {}
  ): Promise<CanaryStatus> {
    const { body } = await transport.request<CanaryStatus>({
      path: `/registry/services/${encodePath(serviceId)}/canary`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function canaryPromote(
    serviceId: string,
    opts: RegistryCallOptions = {}
  ): Promise<CanaryStatus> {
    const { body } = await transport.request<CanaryStatus>({
      path: `/registry/services/${encodePath(serviceId)}/canary/promote`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function canaryRollback(
    serviceId: string,
    opts: RegistryCallOptions = {}
  ): Promise<CanaryStatus> {
    const { body } = await transport.request<CanaryStatus>({
      path: `/registry/services/${encodePath(serviceId)}/canary/rollback`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function canaryGetStatus(
    serviceId: string,
    opts: RegistryCallOptions = {}
  ): Promise<CanaryStatus | null> {
    const { body } = await transport.request<CanaryStatus | null>({
      path: `/registry/services/${encodePath(serviceId)}/canary`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function routesCreate(
    serviceId: string,
    input: CreateRouteInput,
    opts: RegistryCallOptions = {}
  ): Promise<ServiceRoute> {
    const { body } = await transport.request<ServiceRoute>({
      path: `/registry/services/${encodePath(serviceId)}/routes`,
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function routesList(serviceId: string): Paginated<ServiceRoute> {
    return paginate<ServiceRoute>(async () => {
      const { body } = await transport.request<ServiceRoute[]>({
        path: `/registry/services/${encodePath(serviceId)}/routes`,
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function routesRemove(
    serviceId: string,
    routeId: string,
    opts: RegistryCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/registry/services/${encodePath(serviceId)}/routes/${encodePath(routeId)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  function discoverRoutes(): Paginated<DiscoveredRoute> {
    return paginate<DiscoveredRoute>(async () => {
      const { body } = await transport.request<DiscoveredRoute[]>({
        path: "/registry/routes",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  return {
    services: {
      create: servicesCreate,
      list: servicesList,
      get: servicesGet,
      update: servicesUpdate,
      remove: servicesRemove,
      listRevisions: servicesListRevisions,
    },
    canary: {
      start: canaryStart,
      update: canaryUpdate,
      promote: canaryPromote,
      rollback: canaryRollback,
      getStatus: canaryGetStatus,
    },
    routes: {
      create: routesCreate,
      list: routesList,
      remove: routesRemove,
    },
    discoverRoutes,
  };
}
