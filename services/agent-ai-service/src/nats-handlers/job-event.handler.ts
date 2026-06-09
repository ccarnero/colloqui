import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { EventEnvelope } from "@yoizen/shared";
import { JobExecutorService } from "../modules/job-executor/job-executor.service";

@Injectable()
export class JobEventHandler {
  private readonly logger = new PinoLoggerService(JobEventHandler.name);

  constructor(private readonly jobExecutor: JobExecutorService) {}

  async handle(
    tenantId: string,
    payload: Record<string, unknown>,
    _envelope?: EventEnvelope,
  ): Promise<void> {
    const eventName = payload.event_name as string | undefined;
    this.logger.log(
      `[job-event] tenant='${tenantId}' event='${eventName ?? "unknown"}'`,
    );

    await this.jobExecutor.handleObservation(tenantId, payload);
  }
}
