import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { environment } from "../../../environments/environment";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { ResourceMutationsService } from "./metrics/resource-mutations.service";
import {
  type IJob,
  type IJobListQuery,
  type IJobListResponse,
  type ICreateJobData,
  type IUpdateJobData,
  type IJobExecution,
  type ITriggerJobData,
  type IExecutionListQuery,
  type IExecutionListResponse,
} from "../models/scheduler.model";

type QueryValue = string | number | boolean;

const BASE_URL = `${environment.apiUrl}/admin`;

function buildJobQueryParams(
  query?: IJobListQuery,
): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};

  if (!query) {
    return params;
  }

  if (query.agent_id !== undefined) {
    params["agent_id"] = query.agent_id;
  }

  if (query.is_active !== undefined) {
    params["is_active"] = query.is_active;
  }

  if (query.limit !== undefined) {
    params["limit"] = query.limit;
  }

  if (query.offset !== undefined) {
    params["offset"] = query.offset;
  }

  return params;
}

function buildExecutionQueryParams(
  query?: IExecutionListQuery,
): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};

  if (!query) {
    return params;
  }

  if (query.job_id !== undefined) {
    params["job_id"] = query.job_id;
  }

  if (query.status !== undefined) {
    params["status"] = query.status;
  }

  if (query.limit !== undefined) {
    params["limit"] = query.limit;
  }

  if (query.offset !== undefined) {
    params["offset"] = query.offset;
  }

  return params;
}

@Injectable({ providedIn: "root" })
export class SchedulerApiService {
  private readonly http = inject(HttpClient);
  private readonly mutations = inject(ResourceMutationsService);

  // ============================================================================
  // Job CRUD APIs
  // ============================================================================

  /**
   * Lists all scheduled jobs for the active tenant.
   *
   * @param query - Optional filter and pagination parameters.
   * @returns A stream of paginated job data.
   */
  listJobs(query?: IJobListQuery): Observable<IJobListResponse> {
    return this.http.get<IJobListResponse>(`${BASE_URL}/jobs`, {
      params: buildJobQueryParams(query),
    });
  }

  /**
   * Retrieves a specific scheduled job by ID.
   *
   * @param id - The job ID to retrieve.
   * @returns A stream with the job record.
   */
  getJob(id: string): Observable<IJob> {
    return this.http.get<IJob>(`${BASE_URL}/jobs/${id}`);
  }

  /**
   * Creates a new scheduled job.
   *
   * @param data - The job creation payload.
   * @returns A stream with the created job record.
   */
  createJob(data: ICreateJobData): Observable<IJob> {
    const body = {
      name: data.name,
      agent_id: data.agent_id,
      schedule: data.schedule,
      payload: data.payload,
      is_active: data.is_active,
    };
    return this.http
      .post<IJob>(`${BASE_URL}/jobs`, body)
      .pipe(tap(() => this.mutations.notify("processes")));
  }

  /**
   * Updates an existing scheduled job.
   *
   * @param id - The job ID to update.
   * @param data - The job update payload.
   * @returns A stream with the updated job record.
   */
  updateJob(id: string, data: IUpdateJobData): Observable<IJob> {
    const body: Record<string, unknown> = {};
    if (data.name !== undefined) body["name"] = data.name;
    if (data.agent_id !== undefined) body["agent_id"] = data.agent_id;
    if (data.schedule !== undefined) body["schedule"] = data.schedule;
    if (data.payload !== undefined) body["payload"] = data.payload;
    if (data.is_active !== undefined) body["is_active"] = data.is_active;
    return this.http
      .put<IJob>(`${BASE_URL}/jobs/${id}`, body)
      .pipe(tap(() => this.mutations.notify("processes")));
  }

  /**
   * Deletes a scheduled job.
   *
   * @param id - The job ID to delete.
   * @returns A completion stream (HTTP 204).
   */
  deleteJob(id: string): Observable<void> {
    return this.http
      .delete<void>(`${BASE_URL}/jobs/${id}`)
      .pipe(tap(() => this.mutations.notify("processes")));
  }

  // ============================================================================
  // Job lifecycle APIs
  // ============================================================================

  /**
   * Enables a scheduled job.
   *
   * @param id - The job ID to enable.
   * @returns A stream with the updated job record.
   */
  enableJob(id: string): Observable<IJob> {
    return this.http.post<IJob>(`${BASE_URL}/jobs/${id}/enable`, {});
  }

  /**
   * Disables a scheduled job.
   *
   * @param id - The job ID to disable.
   * @returns A stream with the updated job record.
   */
  disableJob(id: string): Observable<IJob> {
    return this.http.post<IJob>(`${BASE_URL}/jobs/${id}/disable`, {});
  }

  /**
   * Triggers an immediate single run of a job without
   * affecting its schedule.
   *
   * @param id - The job ID to run.
   * @returns A stream with the resulting execution record.
   */
  runJob(id: string): Observable<IJobExecution> {
    return this.http.post<IJobExecution>(`${BASE_URL}/jobs/${id}/run`, {});
  }

  /**
   * Sends an event that triggers one or more event-driven jobs.
   *
   * @param id - The job ID to trigger.
   * @param data - Optional event payload.
   * @returns A stream with the resulting execution record.
   */
  triggerJob(id: string, data?: ITriggerJobData): Observable<IJobExecution> {
    return this.http.post<IJobExecution>(
      `${BASE_URL}/jobs/${id}/trigger`,
      data ?? {},
    );
  }

  // ============================================================================
  // Execution history APIs
  // ============================================================================

  /**
   * Lists job executions with optional filtering.
   *
   * @param query - Optional filter and pagination parameters.
   * @returns A stream of paginated execution data.
   */
  listExecutions(
    query?: IExecutionListQuery,
  ): Observable<IExecutionListResponse> {
    return this.http.get<IExecutionListResponse>(`${BASE_URL}/jobs/executions`, {
      params: buildExecutionQueryParams(query),
    });
  }
}
