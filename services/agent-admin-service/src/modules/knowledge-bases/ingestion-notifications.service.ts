import { Inject, Injectable, Logger } from "@nestjs/common";
import { JETSTREAM } from "../../providers/nats.provider";

export interface IngestionFileResult {
  fileId: string;
  status: string;
  [key: string]: unknown;
}

export interface IngestionNotification {
  resource_type: string;
  tenant_id: string;
  kb_id: string;
  job_id: string;
  status: "completed" | "failed";
  files: IngestionFileResult[];
  completed_at: string;
  error?: string;
}

/** NATS subject for ingestion notification events. */
const SUBJECT_TEMPLATE =
  "evt.{tenant}.agent-admin-service.automation.platform.internal.ingestion_notification.v1";

@Injectable()
export class IngestionNotificationsService {
  private readonly logger = new Logger(IngestionNotificationsService.name);

  constructor(
    @Inject(JETSTREAM) private readonly js: any,
  ) {}

  /**
   * Publishes a "completed" ingestion notification.
   * Best-effort: catches errors, logs a warning, and never throws.
   */
  async publishCompleted(
    tenantId: string,
    kbId: string,
    jobId: string,
    files: IngestionFileResult[],
  ): Promise<void> {
    const subject = SUBJECT_TEMPLATE.replace("{tenant}", tenantId);
    const now = new Date().toISOString();

    const payload: IngestionNotification = {
      resource_type: "ingestion",
      tenant_id: tenantId,
      kb_id: kbId,
      job_id: jobId,
      status: "completed",
      files,
      completed_at: now,
    };

    await this.safePublish(subject, payload);
  }

  /**
   * Publishes a "failed" ingestion notification.
   * Best-effort: catches errors, logs a warning, and never throws.
   */
  async publishFailed(
    tenantId: string,
    kbId: string,
    jobId: string,
    error: string,
  ): Promise<void> {
    const subject = SUBJECT_TEMPLATE.replace("{tenant}", tenantId);
    const now = new Date().toISOString();

    const payload: IngestionNotification = {
      resource_type: "ingestion",
      tenant_id: tenantId,
      kb_id: kbId,
      job_id: jobId,
      status: "failed",
      files: [],
      completed_at: now,
      error,
    };

    await this.safePublish(subject, payload);
  }

  /**
   * Wraps JetStream publish in a try/catch so the caller never has to
   * handle publish failures. Logs a warning on error.
   */
  private async safePublish(
    subject: string,
    payload: IngestionNotification,
  ): Promise<void> {
    try {
      await this.js.publish(subject, JSON.stringify(payload));
    } catch (err) {
      this.logger.warn(
        `Failed to publish ingestion notification to ${subject}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
