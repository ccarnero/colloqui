import { inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import type { Observable } from "rxjs";
import { environment } from "../../../../../environments/environment";

export interface IWorkflowDefinitionDto {
  id: string;
  name: string;
  application: string;
  tenantId: string;
  actions: unknown[];
  trigger: unknown | null;
  createdAt: string;
}

export interface IWorkflowExecutionDto {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  runId: string;
}

interface ICreateWorkflowPayload {
  name: string;
  application: string;
  actions: unknown[];
  trigger?: unknown;
}

interface IUpdateWorkflowPayload {
  name: string;
  application: string;
  actions: unknown[];
  trigger?: unknown;
}

@Injectable({ providedIn: "root" })
export class WorkflowApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/workflows`;

  list(): Observable<IWorkflowDefinitionDto[]> {
    return this.http.get<IWorkflowDefinitionDto[]>(this.base);
  }

  get(id: string): Observable<IWorkflowDefinitionDto> {
    return this.http.get<IWorkflowDefinitionDto>(
      `${this.base}/${id}`,
    );
  }

  create(
    payload: ICreateWorkflowPayload,
  ): Observable<IWorkflowDefinitionDto> {
    return this.http.post<IWorkflowDefinitionDto>(
      this.base,
      payload,
    );
  }

  update(
    id: string,
    payload: IUpdateWorkflowPayload,
  ): Observable<IWorkflowDefinitionDto> {
    return this.http.put<IWorkflowDefinitionDto>(
      `${this.base}/${id}`,
      payload,
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  execute(
    id: string,
    request: Record<string, unknown> = {},
  ): Observable<IWorkflowExecutionDto> {
    return this.http.post<IWorkflowExecutionDto>(
      `${this.base}/${id}/execute`,
      { request },
    );
  }
}
