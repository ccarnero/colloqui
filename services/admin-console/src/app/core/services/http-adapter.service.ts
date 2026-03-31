import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";

export interface AdapterEndpointDto {
  id: string;
  adapterId: string;
  label: string;
  method: string;
  path: string;
  createdAt: string;
}

export type AdapterStatus = "enabled" | "disabled";

export interface AdapterDto {
  id: string;
  tenantId: string;
  name: string;
  context: string;
  baseUrl: string;
  authType: string;
  authConfig: Record<string, unknown>;
  headers: Array<{ key: string; value: string }>;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  healthCheckPath: string;
  status: AdapterStatus;
  createdAt: string;
  updatedAt: string;
  endpoints: AdapterEndpointDto[];
}

export interface CreateAdapterPayload {
  name: string;
  context: string;
  baseUrl: string;
  authType?: string;
  authConfig?: Record<string, unknown>;
  headers?: Array<{ key: string; value: string }>;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  healthCheckPath?: string;
  endpoints?: Array<{ label: string; method: string; path: string }>;
}

export interface UpdateAdapterPayload {
  name?: string;
  baseUrl?: string;
  authType?: string;
  authConfig?: Record<string, unknown>;
  headers?: Array<{ key: string; value: string }>;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  healthCheckPath?: string;
  status?: AdapterStatus;
}

@Injectable({ providedIn: "root" })
export class HttpAdapterService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/adapters`;

  list(context?: string): Observable<AdapterDto[]> {
    const url = context ? `${this.base}?context=${context}` : this.base;
    return this.http.get<AdapterDto[]>(url);
  }

  get(id: string): Observable<AdapterDto> {
    return this.http.get<AdapterDto>(`${this.base}/${id}`);
  }

  create(payload: CreateAdapterPayload): Observable<AdapterDto> {
    return this.http.post<AdapterDto>(this.base, payload);
  }

  update(id: string, payload: UpdateAdapterPayload): Observable<AdapterDto> {
    return this.http.patch<AdapterDto>(`${this.base}/${id}`, payload);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  addEndpoint(
    adapterId: string,
    endpoint: { label: string; method: string; path: string },
  ): Observable<AdapterEndpointDto> {
    return this.http.post<AdapterEndpointDto>(
      `${this.base}/${adapterId}/endpoints`,
      endpoint,
    );
  }

  removeEndpoint(adapterId: string, endpointId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/${adapterId}/endpoints/${endpointId}`,
    );
  }
}
