import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";

export type ScheduleType = "cron" | "interval" | "one-time";
export type ExecMode = "js-inline" | "js-k8s" | "docker";

export interface ISchedule {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: ScheduleType;
  enabled: boolean;
  cronExpression?: string;
  intervalSeconds?: number;
  oneTimeAt?: string;
  execMode: ExecMode;
  config: Record<string, unknown>;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IListSchedulesParams {
  enabled?: boolean;
  type?: ScheduleType;
  limit?: number;
  offset?: number;
}

export interface IListSchedulesResponse {
  items: ISchedule[];
  total: number;
}

const BASE = `${environment.apiUrl}/scheduler/schedules`;

@Injectable({ providedIn: "root" })
export class SchedulesService {
  private readonly http = inject(HttpClient);

  list(params: IListSchedulesParams = {}): Observable<IListSchedulesResponse> {
    let p = new HttpParams();
    if (params.enabled !== undefined) p = p.set("enabled", String(params.enabled));
    if (params.type !== undefined) p = p.set("type", params.type);
    if (params.limit !== undefined) p = p.set("limit", String(params.limit));
    if (params.offset !== undefined) p = p.set("offset", String(params.offset));
    return this.http.get<IListSchedulesResponse>(BASE, { params: p });
  }

  get(id: string): Observable<ISchedule> {
    return this.http.get<ISchedule>(`${BASE}/${id}`);
  }

  trigger(id: string): Observable<{ triggered: boolean; schedule_id: string }> {
    return this.http.post<{ triggered: boolean; schedule_id: string }>(
      `${BASE}/${id}/trigger`,
      {},
    );
  }

  setEnabled(id: string, enabled: boolean): Observable<ISchedule> {
    return this.http.patch<ISchedule>(`${BASE}/${id}`, { enabled });
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/${id}`);
  }
}
