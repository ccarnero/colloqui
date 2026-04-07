import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import { NATS_CONNECTION } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import {
  CHANNEL_SUBJECT_PREFIX,
  CHANNEL_DOMAIN,
  parseChannelSubject,
} from "@yoizen/shared";
import type {
  ChannelEnvelope,
  WorkflowTrigger,
  Channel,
  ChannelProvider,
} from "@yoizen/shared";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowsRepository } from "../workflows/workflows.repository";
import type { IWorkflowDefinitionRow } from "../workflows/workflows.repository";

@Injectable()
export class TriggerConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(
    TriggerConsumerService.name,
  );
  private subscription: Subscription | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly workflowsService: WorkflowsService,
    private readonly workflowsRepository: WorkflowsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const subject =
      `${CHANNEL_SUBJECT_PREFIX}.*.${CHANNEL_DOMAIN}.*.*.received.v1`;

    this.subscription = this.nc.subscribe(subject, {
      callback: (_err, msg) => {
        this.handleMessage(msg).catch((err: unknown) => {
          this.logger.warn(
            `Trigger handler error: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });

    this.logger.log(`Workflow trigger consumer subscribed to: ${subject}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  private async handleMessage(
    msg: { subject: string; data: Uint8Array },
  ): Promise<void> {
    const parsed = parseChannelSubject(msg.subject);
    if (!parsed) return;

    const { tenant, channel, provider } = parsed;

    const decoder = new TextDecoder();
    const envelope = JSON.parse(
      decoder.decode(msg.data),
    ) as ChannelEnvelope;

    const definitions =
      await this.workflowsRepository.findDefinitionsByTriggerType(
        tenant,
        "message_received",
      );
    if (definitions.length === 0) return;

    const matching = this.filterMatching(
      definitions,
      channel,
      provider,
      envelope,
    );
    if (matching.length === 0) return;

    const toExecute = this.applyExclusiveSharedLogic(matching);

    const request: Record<string, unknown> = {
      envelope: envelope.data,
      channel,
      provider,
      from: envelope.data.from,
      text: envelope.data.text,
      messageId: envelope.id,
      tenantId: tenant,
    };

    await Promise.all(
      toExecute.map(async (def) => {
        try {
          const result =
            await this.workflowsService.executeWorkflow(
              def.id,
              tenant,
              request,
            );
          this.logger.log(
            `Triggered workflow ${def.name} (${def.id}) -> execution ${result.executionId}`,
          );
        } catch (err: unknown) {
          this.logger.warn(
            `Failed to trigger workflow ${def.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }),
    );
  }

  /**
   * Filters definitions whose trigger config matches the
   * incoming message channel, provider, and optional text patterns.
   */
  private filterMatching(
    definitions: IWorkflowDefinitionRow[],
    channel: string,
    provider: string,
    envelope: ChannelEnvelope,
  ): IWorkflowDefinitionRow[] {
    const result: IWorkflowDefinitionRow[] = [];

    for (const def of definitions) {
      const trigger = def.trigger as WorkflowTrigger | null;
      if (!trigger || trigger.type !== "message_received") continue;

      const cfg = trigger.config;

      if (cfg.accountIds && cfg.accountIds.length > 0) {
        const incomingAccountId =
          envelope.data.accountId as string | undefined;
        if (
          !incomingAccountId ||
          !cfg.accountIds.includes(incomingAccountId)
        ) {
          continue;
        }
      }

      if (
        cfg.channels &&
        cfg.channels.length > 0 &&
        !cfg.channels.includes(channel as Channel)
      ) {
        continue;
      }

      if (
        cfg.providers &&
        cfg.providers.length > 0 &&
        !cfg.providers.includes(provider as ChannelProvider)
      ) {
        continue;
      }

      if (cfg.patterns && cfg.patterns.length > 0) {
        const text =
          (envelope.data.text as string | undefined) ?? "";
        const matched = cfg.patterns.some((pattern) => {
          try {
            return new RegExp(pattern, "i").test(text);
          } catch {
            return text.includes(pattern);
          }
        });
        if (!matched) continue;
      }

      result.push(def);
    }

    return result;
  }

  /**
   * If any matching definition has `mode: "exclusive"`, only the
   * first exclusive one fires. Otherwise all shared workflows fire.
   */
  private applyExclusiveSharedLogic(
    matching: IWorkflowDefinitionRow[],
  ): IWorkflowDefinitionRow[] {
    const exclusive = matching.find((def) => {
      const trigger = def.trigger as WorkflowTrigger;
      return trigger.mode === "exclusive";
    });

    if (exclusive) return [exclusive];

    return matching;
  }
}
