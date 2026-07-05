import type { Paginated } from "../../core/pagination.js";
import { paginate, toOffsetPage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateJobInput,
  Job,
  JobExecution,
  ListJobExecutionsParams,
  ListJobsParams,
  TriggerJobInput,
  UpdateJobInput,
} from "./types.js";

export interface JobsClientDeps {
  transport: Transport;
}

export interface JobsCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface JobExecutionsClient {
  /** `GET /admin/jobs/executions` — real `limit`/`offset` + `{executions,total}` pagination. */
  list(params?: ListJobExecutionsParams): Paginated<JobExecution>;
}

export interface JobsClient {
  /** `POST /admin/jobs` (201). */
  create(input: CreateJobInput, opts?: JobsCallOptions): Promise<Job>;
  /** `GET /admin/jobs` — real `limit`/`offset` + `{jobs,total}` pagination. */
  list(params?: ListJobsParams): Paginated<Job>;
  /** `GET /admin/jobs/:id`. */
  get(id: string, opts?: JobsCallOptions): Promise<Job>;
  /** `PUT /admin/jobs/:id`. */
  update(
    id: string,
    input: UpdateJobInput,
    opts?: JobsCallOptions
  ): Promise<Job>;
  /** `DELETE /admin/jobs/:id`; resolves on 204. */
  remove(id: string, opts?: JobsCallOptions): Promise<void>;
  /** `POST /admin/jobs/:id/enable`. */
  enable(id: string, opts?: JobsCallOptions): Promise<Job>;
  /** `POST /admin/jobs/:id/disable`. */
  disable(id: string, opts?: JobsCallOptions): Promise<Job>;
  /** `POST /admin/jobs/:id/run` (201) — manual run, no payload. */
  run(id: string, opts?: JobsCallOptions): Promise<JobExecution>;
  /**
   * `POST /admin/jobs/:id/trigger` (201). The gateway maps `input.payload`
   * to the downstream `event_payload` field. The job must be `is_active`
   * (`enable()` it first) — a disabled job 400s before the payload is ever
   * read. See `types.ts` for details.
   */
  trigger(
    id: string,
    input?: TriggerJobInput,
    opts?: JobsCallOptions
  ): Promise<JobExecution>;
  executions: JobExecutionsClient;
}

/**
 * Creates the `jobs` namespace client. Follows the `workflows` reference
 * implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md "Resource
 * clients".
 */
export function createJobsClient({ transport }: JobsClientDeps): JobsClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  function toQuery(
    params: Record<string, string | number | boolean | undefined>
  ): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    return qs.length > 0 ? `?${qs}` : "";
  }

  async function create(
    input: CreateJobInput,
    opts: JobsCallOptions = {}
  ): Promise<Job> {
    const { body } = await transport.request<Job>({
      path: "/admin/jobs",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(params: ListJobsParams = {}): Paginated<Job> {
    return paginate<Job>(async ({ limit, offset }) => {
      const { body } = await transport.request<{
        jobs: Job[];
        total: number;
      }>({
        path: `/admin/jobs${toQuery({
          agent_id: params.agent_id,
          is_active: params.is_active,
          limit: params.limit ?? limit,
          offset: params.offset ?? offset,
        })}`,
        method: "GET",
      });
      return toOffsetPage(body.jobs, body.total, params.offset ?? offset);
    });
  }

  async function get(id: string, opts: JobsCallOptions = {}): Promise<Job> {
    const { body } = await transport.request<Job>({
      path: `/admin/jobs/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateJobInput,
    opts: JobsCallOptions = {}
  ): Promise<Job> {
    const { body } = await transport.request<Job>({
      path: `/admin/jobs/${encodePath(id)}`,
      method: "PUT",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function remove(id: string, opts: JobsCallOptions = {}): Promise<void> {
    await transport.request<void>({
      path: `/admin/jobs/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function enable(id: string, opts: JobsCallOptions = {}): Promise<Job> {
    const { body } = await transport.request<Job>({
      path: `/admin/jobs/${encodePath(id)}/enable`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function disable(id: string, opts: JobsCallOptions = {}): Promise<Job> {
    const { body } = await transport.request<Job>({
      path: `/admin/jobs/${encodePath(id)}/disable`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function run(
    id: string,
    opts: JobsCallOptions = {}
  ): Promise<JobExecution> {
    const { body } = await transport.request<JobExecution>({
      path: `/admin/jobs/${encodePath(id)}/run`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function trigger(
    id: string,
    input: TriggerJobInput = {},
    opts: JobsCallOptions = {}
  ): Promise<JobExecution> {
    const { body } = await transport.request<JobExecution>({
      path: `/admin/jobs/${encodePath(id)}/trigger`,
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function executionsList(
    params: ListJobExecutionsParams = {}
  ): Paginated<JobExecution> {
    return paginate<JobExecution>(async ({ limit, offset }) => {
      const { body } = await transport.request<{
        executions: JobExecution[];
        total: number;
      }>({
        path: `/admin/jobs/executions${toQuery({
          job_id: params.job_id,
          status: params.status,
          limit: params.limit ?? limit,
          offset: params.offset ?? offset,
        })}`,
        method: "GET",
      });
      return toOffsetPage(body.executions, body.total, params.offset ?? offset);
    });
  }

  return {
    create,
    list,
    get,
    update,
    remove,
    enable,
    disable,
    run,
    trigger,
    executions: { list: executionsList },
  };
}
