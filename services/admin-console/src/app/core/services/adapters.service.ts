import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { map, type Observable } from "rxjs";
import { environment } from "../../../environments/environment";

export interface IAdapterEndpoint {
  id: string;
  label: string;
  path: string;
  method: string;
}

export type AdapterStatus = "enabled" | "disabled";

export interface IAdapterSummary {
  id: string;
  name: string;
  status: AdapterStatus;
  baseUrl?: string;
  authType?: string;
  hasAuth?: boolean;
  endpoints: IAdapterEndpoint[];
}

export interface IAdapterDetail {
  id: string;
  name: string;
  baseUrl: string;
  status: AdapterStatus;
  authType: string;
  hasAuth: boolean;
  endpoints: IAdapterEndpoint[];
}

@Injectable({ providedIn: "root" })
export class AdaptersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/adapters`;

  listAdapters(): Observable<{ adapters: IAdapterSummary[] }> {
    return this.http
      .get<IAdapterSummary[]>(this.baseUrl)
      .pipe(map((adapters) => ({ adapters })));
  }

  getAdapter(adapterId: string): Observable<IAdapterDetail> {
    return this.http.get<IAdapterDetail>(`${this.baseUrl}/${adapterId}`);
  }
}
