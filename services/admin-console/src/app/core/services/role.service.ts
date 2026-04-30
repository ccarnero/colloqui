import { Injectable, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { environment } from "../../../environments/environment";
import type { ITenantRole, ITenantRolePermission } from "../models/user.model";

const BASE_URL = `${environment.apiUrl}/auth/tenant-roles`;

@Injectable({ providedIn: "root" })
export class RoleService {
  private readonly http = inject(HttpClient);

  readonly roles = signal<ITenantRole[]>([]);
  readonly loading = signal(false);

  loadRoles(): void {
    this.loading.set(true);
    this.http.get<ITenantRole[]>(BASE_URL).subscribe({
      next: (data) => {
        this.roles.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  createRole(
    tenantId: string,
    name: string,
    description: string,
    permissions: ITenantRolePermission[],
  ): void {
    this.http
      .post<ITenantRole>(BASE_URL, {
        tenant_id: tenantId,
        name,
        description,
        permissions,
      })
      .subscribe({
        next: () => this.loadRoles(),
      });
  }

  updateRole(
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: ITenantRolePermission[];
    },
  ): void {
    this.http.patch<ITenantRole>(`${BASE_URL}/${id}`, patch).subscribe({
      next: () => this.loadRoles(),
    });
  }

  deleteRole(id: string): void {
    this.http.delete(`${BASE_URL}/${id}`).subscribe({
      next: () => this.loadRoles(),
    });
  }

  getRole(id: string) {
    return this.http.get<ITenantRole>(`${BASE_URL}/${id}`);
  }

  /**
   * Fetches roles without updating the `roles` signal (e.g. user-create dialog).
   */
  listRoles$(): Observable<ITenantRole[]> {
    return this.http.get<ITenantRole[]>(BASE_URL);
  }

  createRoleRequest(
    tenantId: string,
    name: string,
    description: string,
    permissions: ITenantRolePermission[],
  ): Observable<ITenantRole> {
    return this.http
      .post<ITenantRole>(BASE_URL, {
        tenant_id: tenantId,
        name,
        description,
        permissions,
      })
      .pipe(tap(() => this.loadRoles()));
  }

  patchRoleRequest(
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: ITenantRolePermission[];
    },
  ): Observable<ITenantRole> {
    return this.http
      .patch<ITenantRole>(`${BASE_URL}/${id}`, patch)
      .pipe(tap(() => this.loadRoles()));
  }
}
