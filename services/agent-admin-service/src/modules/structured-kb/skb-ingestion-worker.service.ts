import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  type IMultiTenantConsumerConfig,
  MultiTenantConsumerManager,
  type TenantConnectionManager,
} from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { PermanentError } from "@yoizen/shared";
import type { JetStreamClient, JetStreamManager, JsMsg } from "nats";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.provider";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
// biome-ignore-start lint/style/useImportType: these classes are constructor-injected by NestJS DI — they must be value imports so `design:paramtypes` metadata resolves the real classes at runtime, not `type`.
import { JobTrackingService } from "../knowledge-bases/job-tracking.service";
import { SKBContainersService } from "./skb-containers.service";
import { SKBFileParser } from "./skb-file-parser";
import { SKBRowsRepository } from "./skb-rows.repository";
import { SKBSchemaAnalyzerService } from "./skb-schema-analyzer.service";

// biome-ignore-end lint/style/useImportType

/**
 * Durable consumer name for the SKB ingestion worker.
 */
const DURABLE_NAME = "skb-ingestion-worker";

/** Regex matching every per-tenant ingress stream. */
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
 * Pull-based JetStream consumer that processes SKB file ingestion
 * events across all tenant INGRESS streams.
 *
 * Uses {@link MultiTenantConsumerManager} which:
 *   - Auto-discovers tenant streams via regex at startup
 *   - Creates a durable consumer on each stream (same DURABLE_NAME)
 *   - Spawns a {@link NatsConsumerRunner} per stream with ack/nak/term
 *   - Reconciles periodically to pick up new tenants without restart
 *   - Routes permanent failures to per-tenant DLQ (DLQ-<tenant>)
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
    SKBIngestionWorkerService.name
  );
  private manager: MultiTenantConsumerManager | null = null;

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
        "SERVICE_MODE != worker — skipping SKB ingestion worker init"
      );
      return;
    }

    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: FILTER_SUBJECT,
      description: "SKB file ingestion worker",
      maxDeliver: 5,
      ackWaitMs: 300_000, // 5 min — files can be large
      backoffMs: [60_000, 120_000, 300_000, 600_000],
    };

    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleMessage(msg),
      this.logger
    );

    await this.manager.start();

    this.logger.log(
      `SKB ingestion worker started, consuming '${FILTER_SUBJECT}' from all tenant streams`
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /**
   * Per-message handler invoked by the runner.
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
  private async handleMessage(msg: JsMsg): Promise<void> {
    let envelope: unknown;
    try {
      envelope = msg.json();
    } catch {
      throw new PermanentError(
        "Invalid JSON — cannot parse ingestion envelope",
        PERMANENT_ERROR_STAGE
      );
    }

    if (!envelope || typeof envelope !== "object") {
      throw new PermanentError(
        "Malformed envelope — expected an object",
        PERMANENT_ERROR_STAGE
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
    const categories = Array.isArray(payload.categories)
      ? (payload.categories as string[])
      : [];

    if (!containerId || !fileId || !tenantId) {
      throw new PermanentError(
        `Missing required fields: containerId=${containerId ?? "undefined"}, fileId=${fileId ?? "undefined"}, tenantId=${tenantId ?? "undefined"}`,
        PERMANENT_ERROR_STAGE
      );
    }

    this.logger.log(
      `Processing file ${fileId} for tenant ${tenantId} (container=${containerId})`
    );

    // Step 1: Create job tracking entry
    const trackingKbId = kbId ?? containerId;
    const job = await this.jobTrackingService.createJob(
      tenantId,
      trackingKbId,
      [fileId]
    );

    try {
      // Step 2: Death check — verify container exists before processing
      const container = await this.containerService.findById(
        tenantId,
        containerId
      );
      if (!container) {
        throw new Error(
          `Container ${containerId} was deleted during processing`
        );
      }

      // Step 3: Death check — verify job is still active
      const activeJob = await this.jobTrackingService.getJob(
        tenantId,
        trackingKbId,
        job.jobId
      );
      if (!activeJob) {
        throw new Error(`Job ${job.jobId} was cancelled during processing`);
      }

      // Step 4: Parse the file
      const parsed = await this.fileParser.parseFile(fileUrl ?? "", tenantId);

      // Step 5: Analyze schema (feeds the future schema-persistence step;
      // see skb-schema.repository.ts — not part of this defect's scope)
      await this.schemaAnalyzer.analyze(parsed);

      // Step 6: Insert typed rows. `insertRows` needs a live sql handle for
      // the tenant plus the container it belongs to — both honest,
      // statically-typed arguments matching SKBRowsRepository.insertRows().
      const sql = await this.connectionManager.ensureSchema(tenantId);
      await this.rowStore.insertRows(
        sql,
        tenantId,
        containerId,
        fileId,
        parsed.rows as Record<string, unknown>[],
        categories
      );

      // Step 7: Death check after — verify container still exists
      const containerAfter = await this.containerService.findById(
        tenantId,
        containerId
      );
      if (!containerAfter) {
        // Clean up rows that were just inserted
        await this.rowStore.deleteRowsForFile(tenantId, fileId);
        throw new Error(
          `Container ${containerId} was deleted during processing`
        );
      }

      // Step 8: Update file status to completed
      await this.containerService.updateFileStatus(
        tenantId,
        containerId,
        fileId,
        "completed",
        {}
      );

      // Step 9: Complete the job
      await this.jobTrackingService.completeJob(
        tenantId,
        trackingKbId,
        job.jobId
      );

      // Step 10: Recompute container status
      await this.containerService.updateStatus(tenantId, containerId, "ready");

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
          { error: message }
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
          message
        );
      } catch {
        // Swallow
      }

      // Best-effort: update container status
      try {
        await this.containerService.updateStatus(
          tenantId,
          containerId,
          "failed"
        );
      } catch {
        // Swallow
      }

      // Re-throw so the runner decides the disposition (nak/term)
      throw error;
    }
  }
}
