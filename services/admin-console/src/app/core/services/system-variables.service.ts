import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { environment } from "../../../environments/environment";

export type SystemVariableType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "array"
  | "secret";

export interface ISystemVariable {
  id: string;
  name: string;
  type: SystemVariableType;
  value: unknown;
  label?: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface ISystemVariableListResponse {
  variables: ISystemVariable[];
  total: number;
}

export interface ICreateSystemVariablePayload {
  name: string;
  type: SystemVariableType;
  value: unknown;
  label?: string;
  description?: string;
}

export type IUpdateSystemVariablePayload = Partial<ICreateSystemVariablePayload>;

@Injectable({ providedIn: "root" })
export class SystemVariablesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/admin/system-variables`;

  findAll(): Observable<ISystemVariableListResponse> {
    return this.http.get<ISystemVariableListResponse>(this.base);
  }

  findById(id: string): Observable<ISystemVariable> {
    return this.http.get<ISystemVariable>(`${this.base}/${id}`);
  }

  create(payload: ICreateSystemVariablePayload): Observable<ISystemVariable> {
    return this.http.post<ISystemVariable>(this.base, payload);
  }

  update(
    id: string,
    payload: IUpdateSystemVariablePayload,
  ): Observable<ISystemVariable> {
    return this.http.patch<ISystemVariable>(`${this.base}/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
