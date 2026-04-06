import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import type { AdapterStatus } from "../models/adapter-status";

export interface IAdapterEndpointDto {
  id: string;
  adapterId: string;
  label: string;
  method: string;
  path: string;
  createdAt: string;
}

export type { AdapterStatus };

export interface IAdapterDto {
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
  endpoints: IAdapterEndpointDto[];
}

export interface ICreateAdapterPayload {
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

export interface IUpdateAdapterPayload {
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

  list(context?: string): Observable<IAdapterDto[]> {
    const url = context ? `${this.base}?context=${context}` : this.base;
    return this.http.get<IAdapterDto[]>(url);
  }

  get(id: string): Observable<IAdapterDto> {
    return this.http.get<IAdapterDto>(`${this.base}/${id}`);
  }

  create(payload: ICreateAdapterPayload): Observable<IAdapterDto> {
    return this.http.post<IAdapterDto>(this.base, payload);
  }

  update(id: string, payload: IUpdateAdapterPayload): Observable<IAdapterDto> {
    return this.http.patch<IAdapterDto>(`${this.base}/${id}`, payload);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  addEndpoint(
    adapterId: string,
    endpoint: { label: string; method: string; path: string },
  ): Observable<IAdapterEndpointDto> {
    return this.http.post<IAdapterEndpointDto>(
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
