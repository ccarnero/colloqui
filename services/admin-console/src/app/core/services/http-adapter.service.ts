import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import type { AdapterStatus } from "../models/adapter-status";
import type { IHttpAdapterCacheStrategy } from "../../shared/models/http-adapter.model";

export interface IAdapterCacheStrategyDto {
  enabled: boolean;
  ttlSeconds: number;
  methods?: string[];
  keyHeaders?: string[];
  keyQueryParams?: string[] | "all";
  keyBody?: boolean;
}

export interface IAdapterEndpointDto {
  id: string;
  adapterId: string;
  label: string;
  method: string;
  path: string;
  cache?: IAdapterCacheStrategyDto | null;
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
  defaultCache?: IAdapterCacheStrategyDto | null;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  healthCheckPath: string;
  status: AdapterStatus;
  tags: string[];
  isEncrypted: boolean;
  createdAt: string;
  updatedAt: string;
  endpoints: IAdapterEndpointDto[];
}

export interface ICreateAdapterPayload {
  name: string;
  context: string;
  baseUrl?: string;
  authType?: string;
  authConfig?: Record<string, unknown>;
  headers?: Array<{ key: string; value: string }>;
  defaultCache?: IHttpAdapterCacheStrategy;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  healthCheckPath?: string;
  tags?: string[];
  endpoints?: Array<{
    label: string;
    method: string;
    path: string;
    cache?: IHttpAdapterCacheStrategy;
  }>;
}

export interface IUpdateAdapterPayload {
  name?: string;
  baseUrl?: string;
  authType?: string;
  authConfig?: Record<string, unknown>;
  headers?: Array<{ key: string; value: string }>;
  defaultCache?: IHttpAdapterCacheStrategy | null;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  healthCheckPath?: string;
  status?: AdapterStatus;
  tags?: string[];
}

export interface IListAdaptersParams {
  context?: string;
  tag?: string;
}

@Injectable({ providedIn: "root" })
export class HttpAdapterService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/adapters`;

  list(params?: IListAdaptersParams): Observable<IAdapterDto[]> {
    let httpParams = new HttpParams();
    if (params?.context) {
      httpParams = httpParams.set("context", params.context);
    }
    if (params?.tag) {
      httpParams = httpParams.set("tag", params.tag);
    }
    return this.http.get<IAdapterDto[]>(this.base, { params: httpParams });
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
    endpoint: {
      label: string;
      method: string;
      path: string;
      cache?: IHttpAdapterCacheStrategy;
    },
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

  updateEndpoint(
    adapterId: string,
    endpointId: string,
    payload: {
      label?: string;
      method?: string;
      path?: string;
      cache?: IHttpAdapterCacheStrategy | null;
    },
  ): Observable<IAdapterEndpointDto> {
    return this.http.patch<IAdapterEndpointDto>(
      `${this.base}/${adapterId}/endpoints/${endpointId}`,
      payload,
    );
  }
}
