import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { environment } from "../../../environments/environment";
import type { Observable } from "rxjs";

export interface IAdapterEndpoint {
  id: string;
  label: string;
  path: string;
  method: string;
}

export interface IAdapterSummary {
  id: string;
  name: string;
  status: string;
  baseUrl?: string;
  authType?: string;
  hasAuth?: boolean;
  endpoints: IAdapterEndpoint[];
}

export interface IAdapterDetail {
  id: string;
  name: string;
  baseUrl: string;
  status: string;
  authType: string;
  hasAuth: boolean;
  endpoints: IAdapterEndpoint[];
}

@Injectable({ providedIn: "root" })
export class AdaptersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/admin/adapters`;

  listAdapters(): Observable<{ adapters: IAdapterSummary[] }> {
    return this.http.get<{ adapters: IAdapterSummary[] }>(this.baseUrl);
  }

  getAdapter(adapterId: string): Observable<IAdapterDetail> {
    return this.http.get<IAdapterDetail>(`${this.baseUrl}/${adapterId}`);
  }
}
