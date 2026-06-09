import {
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { SKBContainersService } from "./skb-containers.service";

/**
 * Default check interval: 5 minutes.
 */
const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Files in 'processing' longer than this are considered stuck.
 */
const DEFAULT_STUCK_THRESHOLD_MINUTES = 10;

/**
 * Periodically scans for SKB container files stuck in 'processing'
 * status and resets them to 'failed' so they can be retried.
 *
 * Only runs when SERVICE_MODE === 'worker'.
 */
@Injectable()
export class SKBIngestionWatchdogService
  implements OnModuleInit, OnModuleDestroy
{
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly containerService: SKBContainersService,
    @Optional() checkIntervalMs?: number,
  ) {
    this.checkIntervalMs = checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  }

  async onModuleInit(): Promise<void> {
    if (process.env.SERVICE_MODE !== "worker") {
      console.log(
        "SERVICE_MODE != worker — skipping SKB ingestion watchdog init",
      );
      return;
    }

    console.log(
      `SKB ingestion watchdog starting (interval=${this.checkIntervalMs / 1000}s, threshold=${DEFAULT_STUCK_THRESHOLD_MINUTES}min)`,
    );

    // Run first check immediately, then on interval
    await this.runCheck();
    this.timer = setInterval(() => {
      this.runCheck().catch((err: unknown) => {
        console.error(
          `SKB watchdog check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, this.checkIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runCheck(): Promise<void> {
    try {
      const stuckFiles =
        await this.containerService.findAllContainersWithProcessingFiles(
          DEFAULT_STUCK_THRESHOLD_MINUTES,
        );

      // Track which containers need status recomputation
      const containersToUpdate = new Set<string>();

      for (const file of stuckFiles) {
        // Support both camelCase and snake_case property names
        const record = file as unknown as Record<string, unknown>;
        const tenantId = (record.tenantId as string) ?? (record.tenant_id as string) ?? "";
        const containerId = (record.containerId as string) ?? (record.container_id as string) ?? "";
        const fileId = (record.fileId as string) ?? (record.file_id as string) ?? "";

        try {
          await this.containerService.updateFileStatus(
            tenantId,
            containerId,
            fileId,
            "failed",
            {
              error: `File stuck in 'processing' for more than ${DEFAULT_STUCK_THRESHOLD_MINUTES} minutes — watchdog reset`,
            },
          );

          containersToUpdate.add(`${tenantId}:${containerId}`);

          console.warn(
            `Watchdog: reset stuck file ${fileId} (container=${containerId}, tenant=${tenantId}) — was stuck in processing`,
          );
        } catch (err: unknown) {
          console.error(
            `Watchdog: failed to update stuck file ${fileId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Recompute container status for affected containers
      for (const key of containersToUpdate) {
        try {
          const [tenantId, containerId] = key.split(":");
          await this.containerService.updateStatus(tenantId, containerId);
        } catch (err: unknown) {
          console.error(
            `Watchdog: failed to recompute status for container ${key}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err: unknown) {
      console.error(
        `Watchdog check error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
