import type { HttpTransport } from '../transport';
import type {
  RegisterServiceParams,
  UpdateServiceParams,
  RegisteredService,
  ServiceDetail,
  RevisionInfo,
  CreateRouteParams,
  ServiceRoute,
  StartCanaryParams,
  UpdateCanaryParams,
  CanaryStatus,
} from '../types';

export class RegistryClient {
  constructor(private readonly transport: HttpTransport) {}

  // ---- Services ----

  async register(params: RegisterServiceParams): Promise<RegisteredService> {
    return this.transport.post<RegisteredService>('/registry/services', params);
  }

  async list(): Promise<RegisteredService[]> {
    return this.transport.get<RegisteredService[]>('/registry/services');
  }

  async get(id: string): Promise<ServiceDetail> {
    return this.transport.get<ServiceDetail>(`/registry/services/${enc(id)}`);
  }

  async update(id: string, params: UpdateServiceParams): Promise<RegisteredService> {
    return this.transport.patch<RegisteredService>(`/registry/services/${enc(id)}`, params);
  }

  async remove(id: string): Promise<void> {
    await this.transport.delete(`/registry/services/${enc(id)}`);
  }

  // ---- Revisions ----

  async listRevisions(serviceId: string): Promise<RevisionInfo[]> {
    return this.transport.get<RevisionInfo[]>(`/registry/services/${enc(serviceId)}/revisions`);
  }

  // ---- Canary ----

  async startCanary(serviceId: string, params: StartCanaryParams): Promise<CanaryStatus> {
    return this.transport.post<CanaryStatus>(`/registry/services/${enc(serviceId)}/canary`, params);
  }

  async updateCanary(serviceId: string, params: UpdateCanaryParams): Promise<CanaryStatus> {
    return this.transport.patch<CanaryStatus>(`/registry/services/${enc(serviceId)}/canary`, params);
  }

  async promoteCanary(serviceId: string): Promise<CanaryStatus> {
    return this.transport.post<CanaryStatus>(`/registry/services/${enc(serviceId)}/canary/promote`);
  }

  async rollbackCanary(serviceId: string): Promise<CanaryStatus> {
    return this.transport.post<CanaryStatus>(`/registry/services/${enc(serviceId)}/canary/rollback`);
  }

  async getCanaryStatus(serviceId: string): Promise<CanaryStatus> {
    return this.transport.get<CanaryStatus>(`/registry/services/${enc(serviceId)}/canary`);
  }

  // ---- Routes ----

  async createRoute(serviceId: string, params: CreateRouteParams): Promise<ServiceRoute> {
    return this.transport.post<ServiceRoute>(`/registry/services/${enc(serviceId)}/routes`, params);
  }

  async listRoutes(serviceId: string): Promise<ServiceRoute[]> {
    return this.transport.get<ServiceRoute[]>(`/registry/services/${enc(serviceId)}/routes`);
  }

  async removeRoute(serviceId: string, routeId: string): Promise<void> {
    await this.transport.delete(`/registry/services/${enc(serviceId)}/routes/${enc(routeId)}`);
  }
}

function enc(v: string): string {
  return encodeURIComponent(v);
}
