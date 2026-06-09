import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import {
  JOB_EXECUTIONS_REPOSITORY,
  type IJobExecutionsRepository,
} from "./job-executions.repository.interface";
import { LAZY_NATS } from "../../providers/nats.provider";

@Injectable()
export class JobExecutionStatusConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobExecutionStatusConsumer.name);
  private subscriptions: Subscription[] = [];
  private stopped = false;

  constructor(
    @Inject(LAZY_NATS) private readonly lazyNats: { getConnection(): Promise<NatsConnection> },
    @Inject(JOB_EXECUTIONS_REPOSITORY)
    private readonly executionsRepo: IJobExecutionsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
  }

  private async startConsuming(): Promise<void> {
    try {
      const nc = await this.lazyNats.getConnection();

      // NATS wildcards are token-boundary: `*`/`>` replace entire tokens between dots.
      // `execution_>` is a literal string, not a wildcard — it never matches `execution_failed`.
      // We need separate subscriptions for each event kind.
      const subjects = [
        "evt.*.ai-agent-gateway.automation.platform.internal.execution_completed.v1",
        "evt.*.ai-agent-gateway.automation.platform.internal.execution_failed.v1",
      ];

      for (const subject of subjects) {
        const sub = nc.subscribe(subject);
        this.subscriptions.push(sub);

        this.logger.log(`Subscribed to ${subject}`);

        // Process messages asynchronously per subscription
        (async () => {
          for await (const msg of sub) {
            if (this.stopped) break;

            try {
              await this.handleMessage(msg.subject, msg.data.toString());
            } catch (err) {
              this.logger.error("Error processing execution status event", err);
            }
          }
        })();
      }
    } catch (err) {
      this.logger.error("Failed to subscribe to execution status events", err);
    }
  }

  private async handleMessage(subject: string, rawData: string): Promise<void> {
    const envelope = JSON.parse(rawData) as Record<string, unknown>;

    // Unwrap EventEnvelope — actual payload is at envelope.data.payload
    const envelopeData = envelope["data"] as Record<string, unknown> | undefined;
    const data = (envelopeData?.["payload"] as Record<string, unknown>) ?? envelope;

    // Extract tenant from subject: evt.{tenant}.ai-agent-gateway...
    const tenantId = subject.split(".")[1];

    // Extract kind from subject: evt.{tenant}.ai-agent-gateway...{kind}.v1
    const parts = subject.split(".");
    const kind = parts[parts.length - 2]; // execution_completed or execution_failed

    const executionId = data.executionId as string;
    if (!executionId) {
      this.logger.warn(`[JobExecutionStatusConsumer] Missing executionId in message on ${subject}`);
      return;
    }

    if (kind === "execution_completed") {
      await this.executionsRepo.updateExecutionStatus(
        tenantId,
        executionId,
        "completed",
        (data.result as Record<string, unknown>) ?? null,
        null,
      );
      this.logger.log(`Execution ${executionId} marked as completed`);
    } else if (kind === "execution_failed") {
      await this.executionsRepo.updateExecutionStatus(
        tenantId,
        executionId,
        "failed",
        null,
        (data.error as string) ?? (data.errorMessage as string) ?? "Unknown error",
      );
      this.logger.log(`Execution ${executionId} marked as failed`);
    }
  }
}
