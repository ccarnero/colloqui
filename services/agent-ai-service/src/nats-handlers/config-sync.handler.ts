import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { EventEnvelope } from "@yoizen/shared";
import { ConfigSyncService } from "../modules/config-sync/config-sync.service";

@Injectable()
export class ConfigSyncHandler {
  private readonly logger = new PinoLoggerService(ConfigSyncHandler.name);

  constructor(private readonly configSync: ConfigSyncService) {}

  async handle(
    tenantId: string,
    payload: Record<string, unknown>,
    _envelope?: EventEnvelope,
    action?: string,
  ): Promise<void> {
    if (action === "jobs_sync") {
      await this.configSync.handleJobsSync(tenantId, payload);
      return;
    }

    await this.configSync.handleConfigSync(tenantId, payload);
  }
}
