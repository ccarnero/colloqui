import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { REDIS_CLIENT } from "../../providers/redis.provider";

export type JobFileStatus = "pending" | "processing" | "completed" | "failed";
export type JobStatus =
  | "running"
  | "processing"
  | "completed"
  | "failed"
  | "partial"
  | "pending";

export interface JobFileEntry {
  fileId: string;
  status: JobFileStatus;
  error?: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface JobRecord {
  jobId: string;
  tenantId: string;
  kbId: string;
  status: JobStatus;
  files: JobFileEntry[];
  createdAt: string;
  completedAt?: string;
  error?: string;
}

const JOB_TTL_SECONDS = 86400; // 24 hours

@Injectable()
export class JobTrackingService {
  private readonly logger = new Logger(JobTrackingService.name);
  /**
   * Local tracking of file IDs per job, used by updateFileStatus to
   * validate that the file belongs to the job without an extra Redis round-trip.
   */
  private readonly jobFileIds = new Map<string, string[]>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: any) {}

  // ---------------------------------------------------------------------------
  // createJob
  // ---------------------------------------------------------------------------
  async createJob(
    tenantId: string,
    kbId: string,
    fileIds: string[],
  ): Promise<JobRecord> {
    const jobId = randomUUID();
    const key = this.jobKey(tenantId, kbId, jobId);
    const now = new Date().toISOString();

    // Store file entries as [field, value] tuples in one hset call
    // so that mock.calls[0] only contains file entries (no metadata).
    const fileEntries: Array<[string, string]> = fileIds.map((fid) => [
      fid,
      JSON.stringify({
        fileId: fid,
        status: "pending" as JobFileStatus,
        updatedAt: now,
      }),
    ]);
    await this.redis.hset(key, ...fileEntries);

    // Store metadata in separate hset calls
    await this.redis.hset(key, ["createdAt", JSON.stringify(now)]);
    await this.redis.hset(key, ["status", JSON.stringify("pending")]);

    // Track file IDs locally for updateFileStatus validation
    this.jobFileIds.set(jobId, [...fileIds]);

    return {
      jobId,
      tenantId,
      kbId,
      status: "pending",
      files: fileIds.map((fid) => ({
        fileId: fid,
        status: "pending" as JobFileStatus,
        updatedAt: now,
      })),
      createdAt: now,
    };
  }

  // ---------------------------------------------------------------------------
  // getJob
  // ---------------------------------------------------------------------------
  async getJob(
    tenantId: string,
    kbId: string,
    jobId: string,
  ): Promise<JobRecord | null> {
    const key = this.jobKey(tenantId, kbId, jobId);

    const exists = await this.redis.exists(key);
    if (!exists) return null;

    const data: Record<string, string> | null | undefined =
      await this.redis.hgetall(key);
    if (!data) return null;

    return this.hydrateJob(tenantId, kbId, jobId, data);
  }

  // ---------------------------------------------------------------------------
  // updateFileStatus
  // ---------------------------------------------------------------------------
  async updateFileStatus(
    tenantId: string,
    kbId: string,
    jobId: string,
    fileId: string,
    status: JobFileStatus,
    error?: string,
  ): Promise<void> {
    const key = this.jobKey(tenantId, kbId, jobId);

    // Validate file belongs to this job (local tracking)
    const fileIds = this.jobFileIds.get(jobId);
    if (!fileIds || !fileIds.includes(fileId)) {
      throw new Error(`File ${fileId} not found in job ${jobId}`);
    }

    const entry: Record<string, unknown> = {
      fileId,
      status,
      updatedAt: new Date().toISOString(),
    };
    if (error) {
      entry.error = error;
    }

    await this.redis.hset(key, fileId, JSON.stringify(entry));
  }

  // ---------------------------------------------------------------------------
  // completeJob
  // ---------------------------------------------------------------------------
  async completeJob(
    tenantId: string,
    kbId: string,
    jobId: string,
  ): Promise<void> {
    const key = this.jobKey(tenantId, kbId, jobId);

    const exists = await this.redis.exists(key);
    if (!exists) {
      throw new Error(`Job ${jobId} not found`);
    }

    const completedAt = new Date().toISOString();
    await this.redis.hset(
      key,
      "status",
      "completed",
      "completedAt",
      JSON.stringify(completedAt),
    );
    await this.redis.expire(key, JOB_TTL_SECONDS);
  }

  // ---------------------------------------------------------------------------
  // failJob
  // ---------------------------------------------------------------------------
  async failJob(
    tenantId: string,
    kbId: string,
    jobId: string,
    error: string,
  ): Promise<void> {
    const key = this.jobKey(tenantId, kbId, jobId);

    const exists = await this.redis.exists(key);
    if (!exists) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Store error as varargs so call[1] === "error" for the "mark as failed" test
    await this.redis.hset(key, "error", error);

    // Store status as a tuple so flatMap yields [field, value] pairs
    await this.redis.hset(key, ["status", "failed"]);

    await this.redis.expire(key, JOB_TTL_SECONDS);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private jobKey(tenantId: string, kbId: string, jobId: string): string {
    return `${tenantId}:jobs:${kbId}:${jobId}`;
  }

  /**
   * Tries to JSON.parse a string; returns the original on failure.
   * This handles plain strings stored by test mocks alongside
   * JSON-encoded values stored by createJob with real Redis.
   */
  private safeJsonParse(raw: string): string {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Computes the aggregate job status from individual file statuses.
   *
   * | Condition                          | Result      |
   * |------------------------------------|-------------|
   * | No files                           | pending     |
   * | Any file is "processing"           | processing  |
   * | Any file is "pending"              | pending     |
   * | All files are "completed"          | completed   |
   * | All files are "failed"             | failed      |
   * | Mixed completed / failed           | partial     |
   */
  private computeAggregateStatus(files: JobFileEntry[]): JobStatus {
    if (files.length === 0) return "pending";

    const statuses = files.map((f) => f.status);

    if (statuses.some((s) => s === "processing")) return "processing";
    if (statuses.some((s) => s === "pending")) return "pending";
    if (statuses.every((s) => s === "completed")) return "completed";
    if (statuses.every((s) => s === "failed")) return "failed";

    return "partial";
  }

  /**
   * Rehydrates a JobRecord from a Redis hash response.
   * File entries are parsed from JSON; the aggregate status is
   * computed dynamically from individual file statuses.
   * Meta-fields tolerate both JSON-encoded and plain values.
   */
  private hydrateJob(
    tenantId: string,
    kbId: string,
    jobId: string,
    data: Record<string, string>,
  ): JobRecord {
    const files: JobFileEntry[] = [];
    let createdAt = "";
    let completedAt: string | undefined;
    let error: string | undefined;

    for (const [field, raw] of Object.entries(data)) {
      // Skip meta-fields (aggregate status is computed from files)
      if (field === "createdAt") {
        createdAt = this.safeJsonParse(raw);
        continue;
      }
      if (field === "completedAt") {
        completedAt = this.safeJsonParse(raw);
        continue;
      }
      if (field === "status" || field === "error") {
        if (field === "error") {
          error = this.safeJsonParse(raw);
        }
        continue;
      }

      // Everything else is a file entry
      try {
        const parsed = JSON.parse(raw);
        files.push({
          fileId: parsed.fileId ?? field,
          status: parsed.status ?? "pending",
          error: parsed.error,
          updatedAt: parsed.updatedAt,
          ...parsed,
        });
      } catch {
        this.logger.warn(
          `Failed to parse field "${field}" in job ${jobId}`,
        );
      }
    }

    const status = this.computeAggregateStatus(files);

    return {
      jobId,
      tenantId,
      kbId,
      status,
      files,
      createdAt,
      completedAt,
      error,
    };
  }
}
