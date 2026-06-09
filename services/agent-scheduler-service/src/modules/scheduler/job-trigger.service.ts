import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { NatsSchedulerPublisher } from "../../providers/nats.provider";

@Injectable()
export class JobTriggerService {
  private readonly logger = new PinoLoggerService(JobTriggerService.name);

  constructor(private readonly publisher: NatsSchedulerPublisher) {}

  async publishTrigger(
    tenantId: string,
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const executionId = randomUUID();

    this.logger.log(
      `Triggering job '${jobId}' for tenant '${tenantId}' (execution: ${executionId})`,
    );

    await this.publisher.publishJobTrigger({
      tenantId,
      jobId,
      executionId,
      eventPayload: payload,
    });

    return executionId;
  }
}
