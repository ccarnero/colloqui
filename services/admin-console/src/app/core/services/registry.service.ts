import { HttpClient } from "@angular/common/http";
import { Injectable, inject, signal } from "@angular/core";
import { environment } from "../../../environments/environment";
import type {
  ICreateRoute,
  ICreateService,
  IRegisteredService,
  IServiceDetail,
  IServiceRoute,
  IUpdateService,
} from "../models/registry.model";

const BASE_URL = `${environment.apiUrl}/registry/services`;

@Injectable({ providedIn: "root" })
export class RegistryService {
  private readonly http = inject(HttpClient);

  readonly services = signal<IRegisteredService[]>([]);
  readonly loading = signal(false);

  loadServices(): void {
    this.loading.set(true);
    this.http.get<IRegisteredService[]>(BASE_URL).subscribe({
      next: (data) => {
        this.services.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  getService(id: string) {
    return this.http.get<IServiceDetail>(`${BASE_URL}/${id}`);
  }

  /**
   * Observable variant of {@link loadServices} — returns the tenant's full
   * service list without mutating the `services` signal. Added for T11 of
   * `manual-loops/connectors/connection-call-inspector.md`:
   * `HostedServiceDetailComponent` needs a name -> id lookup (the backend's
   * `GET /services/:id` is id-only, `services.controller.ts` — no name-based
   * route exists) when the route param comes from a deep link that only
   * carries the service's `name` slug (tracked-events `resource`), not its
   * `id` uuid.
   */
  listServices() {
    return this.http.get<IRegisteredService[]>(BASE_URL);
  }

  createService(dto: ICreateService): void {
    this.http.post<IRegisteredService>(BASE_URL, dto).subscribe({
      next: () => this.loadServices(),
    });
  }

  updateService(id: string, dto: IUpdateService): void {
    this.http.patch<IRegisteredService>(`${BASE_URL}/${id}`, dto).subscribe({
      next: () => this.loadServices(),
    });
  }

  deleteService(id: string): void {
    this.http.delete(`${BASE_URL}/${id}`).subscribe({
      next: () => this.loadServices(),
    });
  }

  listRoutes(serviceId: string) {
    return this.http.get<IServiceRoute[]>(`${BASE_URL}/${serviceId}/routes`);
  }

  createRoute(serviceId: string, dto: ICreateRoute) {
    return this.http.post<IServiceRoute>(
      `${BASE_URL}/${serviceId}/routes`,
      dto
    );
  }

  deleteRoute(serviceId: string, routeId: string) {
    return this.http.delete(`${BASE_URL}/${serviceId}/routes/${routeId}`);
  }
}
