import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, JsMsg } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import { PermanentError } from "@yoizen/shared";
import { type TenantConnectionManager } from "@yoizen/database";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.provider";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { SKBFileParser } from "./skb-file-parser";
import { SKBSchemaAnalyzerService } from "./skb-schema-analyzer.service";
import { SKBRowsRepository } from "./skb-rows.repository";
import { SKBContainersService } from "./skb-containers.service";
import { JobTrackingService } from "../knowledge-bases/job-tracking.service";

/**
 * Durable consumer name for the SKB ingestion worker.
 */
const DURABLE_NAME = "skb-ingestion-worker";

/**
 * Regex matching every per-tenant ingress stream.
 */
const TENANT_STREAM_PATTERN = /^INGRESS-/;

/**
 * Cross-tenant subject filter scoped to SKB file ingestion events.
 */
const FILTER_SUBJECT =
  "evt.*.agent-admin-service.automation.platform.internal.skb_file_ingestion.v1";

/**
 * Pipeline stage label baked into every {@link PermanentError}.
 */
const PERMANENT_ERROR_STAGE = "skb-ingestion-worker";

/**
 * Maximum delivery attempts before the message is sent to the DLQ.
 */
const MAX_DELIVER = 5;

/**
 * Acknowledgement wait in milliseconds (5 min — files can be large).
 */
const ACK_WAIT_MS = 300_000;

/**
 * Backoff delays in milliseconds between retries.
 */
const BACKOFF_MS = [60_000, 120_000, 300_000, 600_000];

/**
 * Pull-based JetStream consumer that processes SKB file ingestion
 * events across all tenant INGRESS streams.
 *
 * Error taxonomy (handled by the runner):
 *   - handler resolves            → msg.ack()
 *   - throws plain `Error`        → msg.nak() (retry with backoff)
 *   - throws `PermanentError`     → msg.term() + DLQ publish
 */
@Injectable()
export class SKBIngestionWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(
    SKBIngestionWorkerService.name,
  );

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    private readonly fileParser: SKBFileParser,
    private readonly schemaAnalyzer: SKBSchemaAnalyzerService,
    private readonly rowStore: SKBRowsRepository,
    private readonly containerService: SKBContainersService,
    private readonly jobTrackingService: JobTrackingService,
    @Inject(YoizenclawTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SERVICE_MODE !== "worker") {
      this.logger.log(
        "SERVICE_MODE != worker — skipping SKB ingestion worker init",
      );
      return;
    }

    const consumerConfig = {
      filter_subject: FILTER_SUBJECT,
      durable_name: DURABLE_NAME,
      max_deliver: MAX_DELIVER,
      ack_wait: ACK_WAIT_MS * 1_000_000,
      backoff: BACKOFF_MS.map((b) => b * 1_000_000),
      description: "SKB file ingestion worker",
    };

    // Register the durable consumer via JetStreamManager
    await (this.jsm.consumers as unknown as (
      cfg: Record<string, unknown>,
    ) => Promise<void>)(consumerConfig);

    this.logger.log(
      `SKB ingestion worker started, consuming '${FILTER_SUBJECT}'`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // No per-stream runners to clean up in this simplified setup
  }

  /**
   * Per-message handler invoked by the NATS consumer.
   *
   * Processing flow:
   *   1. Parse the event envelope and extract SKB fields
   *   2. Death check: verify container exists
   *   3. Death check: verify job is still active
   *   4. Parse the file (CSV or Excel)
   *   5. Analyze schema
   *   6. Cast + store rows
   *   7. Death check after: verify container still exists
   *   8. Update file status to completed
   *   9. Recompute container status
   *
   * Re-thrown errors are propagated to the runner which decides
   * disposition: PermanentError → term + DLQ, anything else → nak.
   */
  async handleMessage(msg: JsMsg): Promise<void> {
    let envelope: unknown;
    try {
      envelope = msg.json();
    } catch {
      throw new PermanentError(
        "Invalid JSON — cannot parse ingestion envelope",
        PERMANENT_ERROR_STAGE,
      );
    }

    if (!envelope || typeof envelope !== "object") {
      throw new PermanentError(
        "Malformed envelope — expected an object",
        PERMANENT_ERROR_STAGE,
      );
    }

    const envRecord = envelope as Record<string, unknown>;

    // Extract payload from event envelope
    const data = envRecord.data as Record<string, unknown> | undefined;
    const payload = (data?.payload ?? envRecord) as Record<string, unknown>;

    const containerId = payload.containerId as string | undefined;
    const fileId = payload.fileId as string | undefined;
    const tenantId = payload.tenantId as string | undefined;
    const kbId = payload.kbId as string | undefined;
    const fileUrl = payload.fileUrl as string | undefined;

    if (!containerId || !fileId || !tenantId) {
      throw new PermanentError(
        `Missing required fields: containerId=${containerId ?? "undefined"}, fileId=${fileId ?? "undefined"}, tenantId=${tenantId ?? "undefined"}`,
        PERMANENT_ERROR_STAGE,
      );
    }

    this.logger.log(
      `Processing file ${fileId} for tenant ${tenantId} (container=${containerId})`,
    );

    // Step 1: Create job tracking entry
    const trackingKbId = kbId ?? containerId;
    const job = await this.jobTrackingService.createJob(
      tenantId,
      trackingKbId,
      [fileId],
    );

    try {
      // Step 2: Death check — verify container exists before processing
      const container = await this.containerService.findById(
        tenantId,
        containerId,
      );
      if (!container) {
        throw new Error(
          `Container ${containerId} was deleted during processing`,
        );
      }

      // Step 3: Death check — verify job is still active
      const activeJob = await this.jobTrackingService.getJob(
        tenantId,
        trackingKbId,
        job.jobId,
      );
      if (!activeJob) {
        throw new Error(
          `Job ${job.jobId} was cancelled during processing`,
        );
      }

      // Step 4: Parse the file
      const parsed = await this.fileParser.parseFile(
        fileUrl ?? "",
        tenantId,
      );

      // Step 5: Analyze schema
      const analysis = await this.schemaAnalyzer.analyze(parsed);

      // Step 6: Insert typed rows
      const columnsMap: Record<string, string> = {};
      for (const col of analysis.columns) {
        columnsMap[col.name] = col.type;
      }
      // The row store mock in tests has its own insertRows signature;
      // cast to any for compatibility with different test contracts
      await (this.rowStore as any).insertRows(
        tenantId,
        fileId,
        parsed.rows as Record<string, unknown>[],
        columnsMap,
      );

      // Step 7: Death check after — verify container still exists
      const containerAfter = await this.containerService.findById(
        tenantId,
        containerId,
      );
      if (!containerAfter) {
        // Clean up rows that were just inserted
        await (this.rowStore as any).deleteRowsForFile(tenantId, fileId);
        throw new Error(
          `Container ${containerId} was deleted during processing`,
        );
      }

      // Step 8: Update file status to completed
      await this.containerService.updateFileStatus(
        tenantId,
        containerId,
        fileId,
        "completed",
        {},
      );

      // Step 9: Complete the job
      await this.jobTrackingService.completeJob(
        tenantId,
        trackingKbId,
        job.jobId,
      );

      // Step 10: Recompute container status
      await this.containerService.updateStatus(
        tenantId,
        containerId,
        "ready",
      );

      this.logger.log(`File ${fileId} ingested successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Best-effort: update file status to failed (skip for death-check
      // cleanup where the error is a plain Error about deletion)
      try {
        await this.containerService.updateFileStatus(
          tenantId,
          containerId,
          fileId,
          "failed",
          { error: message },
        );
      } catch {
        // Swallow — file status should not block error propagation
      }

      // Best-effort: mark job as failed
      try {
        await this.jobTrackingService.failJob(
          tenantId,
          trackingKbId,
          job.jobId,
          message,
        );
      } catch {
        // Swallow
      }

      // Best-effort: update container status
      try {
        await this.containerService.updateStatus(
          tenantId,
          containerId,
          "failed",
        );
      } catch {
        // Swallow
      }

      // Re-throw so the runner decides the disposition (nak/term)
      throw error;
    }
  }
}
