/**
 * `@yoizen/platform-sdk/jobs` — the `jobs` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  JobExecutionsClient,
  JobsCallOptions,
  JobsClient,
  JobsClientDeps,
} from "./client.js";
export { createJobsClient } from "./client.js";
export type {
  CreateJobInput,
  Job,
  JobExecution,
  JobExecutionStatus,
  ListJobExecutionsParams,
  ListJobsParams,
  TriggerJobInput,
  UpdateJobInput,
} from "./types.js";
