import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import type { EventEnvelope } from "@yoizen/shared";
import { JobExecutorService } from "../modules/job-executor/job-executor.service";
import type { JobTriggerPayload } from "../modules/job-executor/job-executor.service";
import { JETSTREAM } from "../providers/nats.provider";

@Injectable()
export class JobTriggerHandler {
  private readonly logger = new PinoLoggerService(JobTriggerHandler.name);

  constructor(
    private readonly jobExecutor: JobExecutorService,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
  ) {}

  async handle(
    tenantId: string,
    payload: Record<string, unknown>,
    envelope?: EventEnvelope,
  ): Promise<void> {
    const jobId = payload.job_id as string | undefined;
    if (!jobId) {
      this.logger.warn(
        `[job-trigger] Missing job_id for tenant '${tenantId}'`,
      );
      return;
    }

    this.logger.log(
      `[job-trigger] tenant='${tenantId}' job='${jobId}'`,
    );

    const triggerPayload: JobTriggerPayload = {
      jobId,
      executionId: payload.execution_id as string | undefined,
      eventPayload: (payload.event_payload as Record<string, unknown>) ?? {},
    };

    await this.jobExecutor.executeJob(tenantId, triggerPayload, envelope);
  }
}
