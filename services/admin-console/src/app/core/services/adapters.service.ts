import { Injectable, inject } from "@angular/core";
import { map, type Observable } from "rxjs";
import type { AdapterStatus } from "../models/adapter-status";
import {
  HttpAdapterService,
  type IAdapterDto,
  type IAdapterEndpointDto,
} from "./http-adapter.service";

export interface IAdapterEndpoint {
  id: string;
  label: string;
  path: string;
  method: string;
}

export type { AdapterStatus };

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

function endpointDtoToView(dto: IAdapterEndpointDto): IAdapterEndpoint {
  return {
    id: dto.id,
    label: dto.label,
    path: dto.path,
    method: dto.method,
  };
}

function adapterDtoToSummary(dto: IAdapterDto): IAdapterSummary {
  return {
    id: dto.id,
    name: dto.name,
    status: dto.status,
    baseUrl: dto.baseUrl,
    authType: dto.authType,
    hasAuth: dto.authType !== "none",
    endpoints: dto.endpoints.map(endpointDtoToView),
  };
}

function adapterDtoToDetail(dto: IAdapterDto): IAdapterDetail {
  return {
    id: dto.id,
    name: dto.name,
    baseUrl: dto.baseUrl,
    status: dto.status,
    authType: dto.authType,
    hasAuth: dto.authType !== "none",
    endpoints: dto.endpoints.map(endpointDtoToView),
  };
}

/**
 * Read-only adapter list/detail for YoizenClaw tooling. Delegates HTTP to
 * {@link HttpAdapterService} to avoid duplicating `/adapters` client logic.
 */
@Injectable({ providedIn: "root" })
export class AdaptersService {
  private readonly httpAdapter = inject(HttpAdapterService);

  listAdapters(): Observable<{ adapters: IAdapterSummary[] }> {
    return this.httpAdapter
      .list()
      .pipe(map((adapters) => ({ adapters: adapters.map(adapterDtoToSummary) })));
  }

  getAdapter(adapterId: string): Observable<IAdapterDetail> {
    return this.httpAdapter
      .get(adapterId)
      .pipe(map(adapterDtoToDetail));
  }
}
