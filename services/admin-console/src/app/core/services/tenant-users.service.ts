import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import type { IUser } from "../models";

export interface ICreateTenantUserBody {
  tenant_id: string | null;
  email: string;
  password: string;
  role_id: string;
  display_name?: string;
}

@Injectable({ providedIn: "root" })
export class TenantUsersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/auth/tenant-users`;

  listUsers(): Observable<IUser[]> {
    return this.http.get<IUser[]>(this.baseUrl);
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  createUser(body: ICreateTenantUserBody): Observable<unknown> {
    return this.http.post(this.baseUrl, body);
  }
}
