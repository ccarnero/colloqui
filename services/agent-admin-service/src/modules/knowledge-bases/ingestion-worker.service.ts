import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, JsMsg } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
  type TenantConnectionManager,
} from "@yoizen/database";
import { PermanentError } from "@yoizen/shared";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.provider";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { DocumentsService } from "./documents.service";
import { JobTrackingService } from "./job-tracking.service";
import { IngestionNotificationsService } from "./ingestion-notifications.service";
import { verifyKbExists, verifyJobActive } from "./death-checks";

/**
 * Durable name shared across every tenant INGRESS stream. The same
 * name is reused per stream so
 * `jetstream_consumer_num_pending{consumer_name="ingestion-worker"}`
 * aggregates across tenants in a single Prometheus query.
 */
const DURABLE_NAME = "ingestion-worker";

/** Regex matching every per-tenant ingress stream. */
const TENANT_STREAM_PATTERN = /^INGRESS-/;

/**
 * Cross-tenant subject filter scoped to document ingestion events.
 * The `evt.*.…` wildcard works because the manager binds one consumer
 * per tenant stream — the stream itself enforces tenant isolation.
 */
const FILTER_SUBJECT =
  "evt.*.agent-admin-service.automation.platform.internal.document_ingestion.v1";

/** Pipeline stage label baked into every {@link PermanentError}. */
const PERMANENT_ERROR_STAGE = "ingestion-worker";

/**
 * Pull-based JetStream consumer that processes document ingestion
 * events across all tenant `INGRESS-*` streams.
 *
 * Uses {@link MultiTenantConsumerManager} which:
 *   - Auto-discovers tenant streams via regex at startup
 *   - Creates a durable consumer on each stream (same `DURABLE_NAME`)
 *   - Spawns a {@link NatsConsumerRunner} per stream with ack/nak/term
 *   - Reconciles periodically to pick up new tenants without restart
 *   - Routes permanent failures to per-tenant DLQ (`DLQ-<tenant>`)
 *
 * Error taxonomy (handled by the runner):
 *   - handler resolves             → `msg.ack()`
 *   - throws plain `Error`         → `msg.nak()` (retry with backoff)
 *   - throws `PermanentError`      → `msg.term()` + DLQ publish
 */
@Injectable()
export class IngestionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(IngestionWorkerService.name);
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    private readonly documentsService: DocumentsService,
    private readonly jobTrackingService: JobTrackingService,
    private readonly ingestionNotificationsService: IngestionNotificationsService,
    @Inject(YoizenclawTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SERVICE_MODE !== "worker") {
      this.logger.log(
        "SERVICE_MODE != worker — skipping ingestion worker init",
      );
      return;
    }

    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: FILTER_SUBJECT,
      description:
        "Document ingestion worker — text extraction + chunking + embedding",
      maxDeliver: 5,
      ackWaitMs: 300_000, // 5 min — large docs can take a while
      backoffMs: [60_000, 120_000, 300_000, 600_000],
    };

    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleMessage(msg),
      this.logger,
    );

    await this.manager.start();

    this.logger.log(
      `Ingestion worker started, consuming '${FILTER_SUBJECT}' from all tenant streams`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /**
   * Returns true when every bound per-tenant runner reports healthy.
   * Returns false when not started or no streams are bound yet.
   * Designed for `/health` endpoints.
   */
  isHealthy(): boolean {
    if (!this.manager) return false;
    const streams = this.manager.getBoundStreams();
    if (streams.length === 0) return false;
    for (const stream of streams) {
      const runner = this.manager.getRunner(stream);
      if (!runner?.isHealthy()) return false;
    }
    return true;
  }

  /**
   * Per-message handler invoked by the runner.
   *
   * Integrates job tracking, death checks, and ingestion notifications:
   *   1. Creates a job tracking record for the document
   *   2. Verifies the knowledge base and job are still active (death checks)
   *   3. Runs document ingestion (chunking + embedding)
   *   4. Verifies KB still exists after ingestion (mid-flight deletion detection)
   *   5. Updates file status and publishes completion/failure notification
   *
   * Re-thrown errors are propagated to the runner which decides
   * disposition: `PermanentError` → `term` + DLQ, anything else → `nak`.
   */
  private async handleMessage(msg: JsMsg): Promise<void> {
    let envelope: Record<string, unknown>;
    try {
      envelope = msg.json() as Record<string, unknown>;
    } catch {
      throw new PermanentError(
        "Invalid JSON — cannot parse ingestion envelope",
        PERMANENT_ERROR_STAGE,
      );
    }

    // Support both EventEnvelope (data.payload) and bare payload formats
    const data = envelope.data as Record<string, unknown> | undefined;
    const payload = (data?.payload ?? envelope) as Record<string, unknown>;

    const documentId = payload.documentId as string | undefined;
    const tenantId = payload.tenantId as string | undefined;
    const kbId = payload.kbId as string | undefined;

    if (!documentId || !tenantId || !kbId) {
      throw new PermanentError(
        `Missing required fields: documentId=${documentId ?? "undefined"}, tenantId=${tenantId ?? "undefined"}, kbId=${kbId ?? "undefined"}`,
        PERMANENT_ERROR_STAGE,
      );
    }

    this.logger.log(
      `Processing document ${documentId} for tenant ${tenantId} (kb=${kbId})`,
    );

    // Step 1: Create job tracking entry
    const job = await this.jobTrackingService.createJob(
      tenantId,
      kbId,
      [documentId],
    );

    try {
      // Step 2a: Death check — verify KB still exists before processing
      await verifyKbExists(
        (t: string, k: string) => this.kbExists(t, k),
        tenantId,
        kbId,
      );

      // Step 2b: Death check — verify job is still active
      await verifyJobActive(
        (t: string, k: string, j: string) => this.jobActive(t, k, j),
        tenantId,
        kbId,
        job.jobId,
      );

      // Step 3: Run ingestion
      await this.documentsService.ingest(tenantId, documentId);

      // Step 4: Death check after ingest — detect mid-flight deletion
      await verifyKbExists(
        (t: string, k: string) => this.kbExists(t, k),
        tenantId,
        kbId,
      );

      // Step 5a: Update file status to completed
      await this.jobTrackingService.updateFileStatus(
        tenantId,
        kbId,
        job.jobId,
        documentId,
        "completed",
      );

      // Step 5b: Complete the job
      await this.jobTrackingService.completeJob(tenantId, kbId, job.jobId);

      // Step 5c: Publish completed notification
      await this.ingestionNotificationsService.publishCompleted(
        tenantId,
        kbId,
        job.jobId,
        [{ fileId: documentId, status: "completed" }],
      );

      this.logger.log(`Document ${documentId} ingested successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Best-effort: update file status to failed
      try {
        await this.jobTrackingService.updateFileStatus(
          tenantId,
          kbId,
          job.jobId,
          documentId,
          "failed",
          message,
        );
      } catch {
        // Swallow — job tracking should not block error propagation
      }

      // Best-effort: mark job as failed
      try {
        await this.jobTrackingService.failJob(
          tenantId,
          kbId,
          job.jobId,
          message,
        );
      } catch {
        // Swallow
      }

      // Best-effort: publish failure notification
      await this.ingestionNotificationsService.publishFailed(
        tenantId,
        kbId,
        job.jobId,
        message,
      );

      // Re-throw so the runner decides the disposition (nak/term)
      throw error;
    }
  }

  /**
   * Checks whether a knowledge base still exists in the database.
   * Used by death checks before and after ingestion.
   */
  private async kbExists(tenantId: string, kbId: string): Promise<boolean> {
    try {
      const sql = await this.connectionManager.ensureSchema(tenantId);
      const [row] = await sql<
        Array<{ exists: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM knowledge_bases WHERE id = ${kbId} AND tenant_id = ${tenantId} AND is_active = true) as exists`;
      return row?.exists ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Checks whether a job is still active in Redis.
   * Used by death checks during processing.
   */
  private async jobActive(
    tenantId: string,
    kbId: string,
    jobId: string,
  ): Promise<boolean> {
    try {
      const job = await this.jobTrackingService.getJob(tenantId, kbId, jobId);
      return job !== null;
    } catch {
      return false;
    }
  }
}
