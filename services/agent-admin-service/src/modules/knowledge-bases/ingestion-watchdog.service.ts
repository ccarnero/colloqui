import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DocumentsService } from "./documents.service";

/** How often the watchdog checks for stuck documents (5 minutes). */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Documents in 'processing' longer than this are considered stuck. */
const DEFAULT_STUCK_THRESHOLD_MINUTES = 10;

/**
 * Periodically scans for documents stuck in 'processing' status and
 * marks them as 'failed' so they can be retried via the UI.
 *
 * Only runs when SERVICE_MODE === 'worker'.
 */
@Injectable()
export class IngestionWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionWatchdogService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly documentsService: DocumentsService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SERVICE_MODE !== "worker") {
      this.logger.log(
        "SERVICE_MODE != worker — skipping ingestion watchdog init",
      );
      return;
    }

    this.logger.log(
      `Ingestion watchdog starting (interval=${CHECK_INTERVAL_MS / 1000}s, threshold=${DEFAULT_STUCK_THRESHOLD_MINUTES}min)`,
    );

    // Run first check immediately, then on interval
    await this.runCheck();
    this.timer = setInterval(() => {
      this.runCheck().catch((err: unknown) => {
        this.logger.error(
          `Watchdog check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, CHECK_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log("Ingestion watchdog stopped");
    }
  }

  private async runCheck(): Promise<void> {
    try {
      const resetDocs =
        await this.documentsService.resetStuckProcessingDocuments(
          DEFAULT_STUCK_THRESHOLD_MINUTES,
        );
      if (resetDocs.length > 0) {
        this.logger.warn(
          `Watchdog reset ${resetDocs.length} stuck document(s)`,
        );
      }
    } catch (err: unknown) {
      this.logger.error(
        `Watchdog runCheck error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
