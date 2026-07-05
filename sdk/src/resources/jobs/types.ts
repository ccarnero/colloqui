/**
 * Request/response types for the `jobs` resource, hand-typed against the
 * REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 6):
 *
 * - `services/api-gateway/src/modules/admin/admin-jobs.controller.ts` (+
 *   `admin.dto.ts`) — proxies via `AdminProxyService` to
 *   `agent-admin-service`.
 * - `services/agent-admin-service/src/modules/jobs/{jobs.controller.ts,
 *   jobs.dto.ts, jobs.repository.interface.ts,
 *   job-executions.repository.interface.ts}` define the real DTOs/shapes.
 *
 * FIXED (gateway-side): `POST /admin/jobs/:id/trigger` previously had a
 * FIELD-NAME MISMATCH — the gateway's `TriggerJobDto` field was `payload`,
 * but the downstream `trigger()` handler reads `dto.event_payload`, so a
 * caller's `payload` was silently dropped and never reached the job
 * execution's `event_payload`. The gateway's `AdminJobsController.triggerJob`
 * now explicitly remaps `{ event_payload: body.payload }` before proxying,
 * so the SDK's `payload` field (unchanged) round-trips correctly. Confirmed
 * live via manual curl against the dev cluster's running pod (api-gateway
 * revision 00003) on 2026-07-05: an *active* job's `POST .../trigger` with
 * `{ payload: {...} }` returns 201 with `event_payload` populated as
 * expected — the fix is deployed and working.
 *
 * NOTE: `agent-admin-service`'s `JobsService.trigger()` (and `.run()`)
 * unconditionally reject a job whose `is_active` is `false` with a 400
 * `BadRequestException("Job '<name>' is not active")`, checked BEFORE the
 * payload is ever read — see `jobs.service.ts` around the `trigger()`/`run()`
 * methods. A 400 on a disabled job is this business rule working as
 * intended, not a regression of the payload-mapping fix above; the caller
 * must `enable()` the job first.
 *
 * Other known gaps:
 * - The gateway's `CreateJobDto` doesn't validate `agent_id` as a UUID or
 *   `schedule` as a valid cron expression — only the downstream DTO does
 *   (`@IsUUID()` / a custom `@IsSchedule()` validator). A malformed cron or
 *   non-UUID `agent_id` passes gateway validation and 400s downstream.
 * - `GET /admin/jobs/:id` gateway-side `@Param("id", ParseUUIDPipe)` 400s on
 *   a non-UUID id before ever reaching the downstream service.
 */

export interface CreateJobInput {
  /** Max 255 characters. */
  name: string;
  agent_id: string;
  /** Cron expression, max 255 characters. */
  schedule: string;
  payload?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateJobInput {
  name?: string;
  agent_id?: string;
  schedule?: string;
  payload?: Record<string, unknown>;
  is_active?: boolean;
}

export interface ListJobsParams {
  agent_id?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface Job {
  id: string;
  name: string;
  agent_id: string;
  schedule: string;
  payload: Record<string, unknown>;
  is_active: boolean;
  /** ISO-8601 timestamp, or `null` if the job has never run. */
  last_run: string | null;
  /** ISO-8601 timestamp, or `null` if inactive/unscheduled. */
  next_run: string | null;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

/**
 * `POST /admin/jobs/:id/trigger` body. The gateway's `TriggerJobDto` field
 * is `payload` (kept for API stability); `AdminJobsController.triggerJob`
 * maps it to `event_payload` before proxying downstream, so `payload`
 * correctly reaches the execution's `event_payload`. The target job must be
 * `is_active` (`enable()` it first) or the downstream service 400s before
 * ever reading this body — see the file header.
 */
export interface TriggerJobInput {
  payload?: Record<string, unknown>;
}

export type JobExecutionStatus = "pending" | "running" | "completed" | "failed";

export interface JobExecution {
  id: string;
  job_id: string;
  job_name?: string;
  status: JobExecutionStatus;
  event_payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  logs: string[];
  error_message: string | null;
  retry_count: number;
  triggered_by: string | null;
  /** ISO-8601 timestamp, or `null` before the execution starts. */
  started_at: string | null;
  /** ISO-8601 timestamp, or `null` before the execution finishes. */
  finished_at: string | null;
  /** ISO-8601 timestamp. */
  created_at: string;
}

export interface ListJobExecutionsParams {
  job_id?: string;
  status?: JobExecutionStatus;
  limit?: number;
  offset?: number;
}
