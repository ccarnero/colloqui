import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { type Observable, of } from "rxjs";
import { map, switchMap, tap } from "rxjs/operators";
import { environment } from "../../../../../environments/environment";
import { ResourceMutationsService } from "../../../../core/services/metrics/resource-mutations.service";
import type { INodeStatsRow } from "../domain/map-node-stats-to-view-models";

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

/**
 * A single row of `topByExecutionCountLast7d` in `IWorkflowsSummary`.
 * Mirrors `ITopDefinitionRow` (workflow-service
 * `executions.repository.interface.ts:40-45`) field-for-field — no
 * status/success breakdown exists server-side, so none is added here.
 */
export interface ITopDefinitionRow {
  definition_id: string;
  name: string;
  application: string;
  count: number;
}

/**
 * Response shape of `GET /workflows/summary`. Mirrors
 * `IWorkflowsSummary` (workflow-service `workflows.service.ts:212-221`)
 * field-for-field — T01 finding 1: this endpoint already exists and is
 * proxied by api-gateway; `WorkflowApiService` previously had no wrapper
 * for it.
 */
export interface IWorkflowsSummary {
  activeDefinitions: number;
  definitionsFailingNow: number;
  definitionsWithFailuresLast7d: number;
  executionsCompletedLast7d: number;
  executionsFailedLast7d: number;
  executionsRunningLast7d: number;
  executionsCompletedLast24h: number;
  topByExecutionCountLast7d: ITopDefinitionRow[];
}

/**
 * Response shape of `GET /workflows/:id/correlation-ids` — first hop of
 * T07's per-node stats join (T06 findings' `definitionId -> correlationIds[]`
 * step, workflow-service `workflows.controller.ts` `getCorrelationIds`).
 */
interface ICorrelationIdsResponse {
  correlationIds: string[];
}

/**
 * Response shape of `GET /tracking/node-stats` — second hop of T07's
 * per-node stats join, wire-faithful to tracking-ingester-service's
 * `NodeStatsResponse` (`to-node-stats-response.ts`).
 */
interface INodeStatsResponse {
  tenant: string;
  correlationIdCount: number;
  rowCount: number;
  rows: INodeStatsRow[];
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
   * Tenant-wide workflows summary: 7d/24h execution windows plus the
   * real, 7-day-windowed per-workflow run counts for the top 5
   * workflows by execution count. Wired to the existing
   * `GET /workflows/summary` endpoint (workflow-service
   * `workflows.controller.ts:82-85`, proxied by api-gateway
   * `workflows.controller.ts:120-127`) — T01 finding 1: no new backend
   * endpoint, this method closes the admin-console wiring gap.
   */
  getSummary(): Observable<IWorkflowsSummary> {
    return this.http.get<IWorkflowsSummary>(`${this.base}/summary`);
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

  /**
   * T07 of console-redesign-builder-v2.md — the option-(b) per-node stats
   * fetch recorded in that SPEC's "T06 findings": resolves
   * `definitionId -> correlationIds[]` (workflow-service's
   * `GET /workflows/:id/correlation-ids`, 7d-windowed) then, only if that
   * list is non-empty, aggregates over them via tracking-ingester-service's
   * `GET /tracking/node-stats` (proxied by api-gateway). A definition with
   * no runs in the window short-circuits to `[]` WITHOUT a second HTTP call
   * — the legitimate zero-runs empty case, never treated as an error.
   * Callers (the builder) fetch this ONCE per builder load and cache the
   * result in a signal; this method itself performs no caching.
   */
  getNodeStatsForDefinition(definitionId: string): Observable<INodeStatsRow[]> {
    return this.http
      .get<ICorrelationIdsResponse>(
        `${this.base}/${definitionId}/correlation-ids`
      )
      .pipe(
        switchMap((res) => {
          if (res.correlationIds.length === 0) {
            return of<INodeStatsRow[]>([]);
          }
          const params = new HttpParams().set(
            "correlationIds",
            res.correlationIds.join(",")
          );
          return this.http
            .get<INodeStatsResponse>(
              `${environment.apiUrl}/tracking/node-stats`,
              {
                params,
              }
            )
            .pipe(map((res2) => res2.rows));
        })
      );
  }
}
