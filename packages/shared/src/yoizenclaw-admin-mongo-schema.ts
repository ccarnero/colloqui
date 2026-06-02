import type { IMongoCollectionSchema } from "./mongo-schema.types";

/**
 * Per-tenant YoizenClaw admin collections — agents, credentials, jobs,
 * executions, and config files. Applied lazily on first tenant access.
 */
export const YOIZENCLAW_ADMIN_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "agents",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_agents" },
      },
      {
        keys: { status: 1 },
        options: { name: "idx_agents_status" },
      },
      {
        keys: { created_at: -1 },
        options: { name: "idx_agents_created_at" },
      },
    ],
  },
  {
    collection: "credentials",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_credentials" },
      },
      {
        keys: { sync_status: 1 },
        options: {
          name: "idx_credentials_sync_status",
          partialFilterExpression: { is_active: true },
        },
      },
      {
        keys: { provider: 1 },
        options: {
          name: "idx_credentials_provider",
          partialFilterExpression: { is_active: true },
        },
      },
    ],
  },
  {
    collection: "jobs",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_jobs" },
      },
      {
        keys: { agent_id: 1 },
        options: { name: "idx_jobs_agent_id" },
      },
      {
        keys: { is_active: 1 },
        options: {
          name: "idx_jobs_active",
          partialFilterExpression: { is_active: true },
        },
      },
    ],
  },
  {
    collection: "job_executions",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_job_executions" },
      },
      {
        keys: { job_id: 1 },
        options: { name: "idx_job_executions_job_id" },
      },
    ],
  },
  {
    collection: "config_files",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_config_files" },
      },
      {
        keys: { path: 1 },
        options: { unique: true, name: "uniq_config_files_path" },
      },
    ],
  },
];
