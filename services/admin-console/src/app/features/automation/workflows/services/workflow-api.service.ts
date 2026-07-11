import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { environment } from "../../../../../environments/environment";
import { ResourceMutationsService } from "../../../../core/services/metrics/resource-mutations.service";

export type WorkflowStatus = "enabled" | "disabled";

export interface IWorkflowDefinitionDto {
  id: string;
  name: string;
  application: string;
  tenantId: string;
  actions: unknown[];
  trigger: unknown | null;
  variables?: Record<string, unknown>;
  status?: WorkflowStatus;
  createdAt: string;
}

/**
 * Response from `PATCH /workflows/:id/status`: the updated workflow
 * fields plus a count of executions terminated as a side effect of
 * disabling the workflow.
 */
export interface IWorkflowStatusUpdateResponse extends IWorkflowDefinitionDto {
  terminated: number;
}

export interface IWorkflowExecutionDto {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  runId: string;
}

export type ExecutionSortDirection = "asc" | "desc";

/** Single execution row returned by the paginated list endpoint. */
export interface IWorkflowExecutionRow {
  id: string;
  definitionId: string;
  tenantId: string;
  temporalWorkflowId: string;
  temporalRunId: string;
  request: unknown;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface IWorkflowExecutionsPage {
  items: IWorkflowExecutionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IListExecutionsOptions {
  page: number;
  pageSize: number;
  sort: ExecutionSortDirection;
}

/**
 * Per-action results + overall failure info returned by
 * `GET /workflows/:id/executions/:executionId`.
 */
export interface IWorkflowExecutionDetail {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  temporalRunId?: string;
  status: string;
  result?: {
    workflow?: unknown;
    request?: unknown;
    results?: Record<string, unknown>;
  };
  failure?: {
    message: string;
    type: string;
    activityName?: string;
    cause?: string;
  };
  createdAt: string;
}

interface ICreateWorkflowPayload {
  name: string;
  application: string;
  actions: unknown[];
  trigger?: unknown;
  variables?: Record<string, unknown>;
}

interface IUpdateWorkflowPayload {
  name: string;
  application: string;
  actions: unknown[];
  trigger?: unknown;
  variables?: Record<string, unknown>;
}

@Injectable({ providedIn: "root" })
export class WorkflowApiService {
  private readonly http = inject(HttpClient);
  private readonly mutations = inject(ResourceMutationsService);
  private readonly base = `${environment.apiUrl}/workflows`;

  list(): Observable<IWorkflowDefinitionDto[]> {
    return this.http.get<IWorkflowDefinitionDto[]>(this.base);
  }

  get(id: string): Observable<IWorkflowDefinitionDto> {
    return this.http.get<IWorkflowDefinitionDto>(`${this.base}/${id}`);
  }

  create(payload: ICreateWorkflowPayload): Observable<IWorkflowDefinitionDto> {
    return this.http
      .post<IWorkflowDefinitionDto>(this.base, payload)
      .pipe(tap(() => this.mutations.notify("processes")));
  }

  update(
    id: string,
    payload: IUpdateWorkflowPayload
  ): Observable<IWorkflowDefinitionDto> {
    return this.http.put<IWorkflowDefinitionDto>(`${this.base}/${id}`, payload);
  }

  /**
   * Toggles a workflow definition's enabled/disabled status. Disabling
   * terminates in-flight executions server-side; the response reports
   * how many were terminated.
   */
  setStatus(
    id: string,
    status: WorkflowStatus
  ): Observable<IWorkflowStatusUpdateResponse> {
    return this.http.patch<IWorkflowStatusUpdateResponse>(
      `${this.base}/${id}/status`,
      { status }
    );
  }

  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.base}/${id}`)
      .pipe(tap(() => this.mutations.notify("processes")));
  }

  execute(
    id: string,
    options?: {
      agentTimeoutSec?: number;
      request?: Record<string, string>;
    }
  ): Observable<IWorkflowExecutionDto> {
    return this.http.post<IWorkflowExecutionDto>(`${this.base}/${id}/execute`, {
      request: options?.request ?? {},
      ...(options?.agentTimeoutSec !== undefined && {
        agentTimeoutSec: options.agentTimeoutSec,
      }),
    });
  }

  /**
   * Server-side paginated executions for a single definition. The
   * tuple `(page, pageSize, sort)` matches the workflow-service query
   * shape verbatim; the backend clamps invalid values to defaults.
   */
  listExecutions(
    definitionId: string,
    opts: IListExecutionsOptions
  ): Observable<IWorkflowExecutionsPage> {
    const params = new HttpParams()
      .set("page", String(opts.page))
      .set("pageSize", String(opts.pageSize))
      .set("sort", opts.sort);
    return this.http.get<IWorkflowExecutionsPage>(
      `${this.base}/${definitionId}/executions`,
      { params }
    );
  }

  /**
   * Tenant-wide map of `definitionId -> executionsCount`. The caller
   * folds it into a `Map<string, number>` for O(1) per-card lookups.
   */
  getExecutionCounts(): Observable<Record<string, number>> {
    return this.http.get<Record<string, number>>(
      `${this.base}/executions/counts`
    );
  }

  /**
   * Per-action results for a single execution. Triggers a Temporal
   * `describe + result` round-trip in workflow-service, so callers
   * should cache the response per `executionId` (the dialog uses a
   * `Map<string, IWorkflowExecutionDetail>`).
   */
  getExecutionDetail(
    definitionId: string,
    executionId: string
  ): Observable<IWorkflowExecutionDetail> {
    return this.http.get<IWorkflowExecutionDetail>(
      `${this.base}/${definitionId}/executions/${executionId}`
    );
  }
}
