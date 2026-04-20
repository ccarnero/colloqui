import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
} from "nats";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  PinoLoggerService,
  createNatsConsumerMetrics,
} from "@yoizen/observability";
import {
  CHANNEL_SUBJECT_PREFIX,
  CHANNEL_PRODUCER,
  CHANNEL_DOMAIN,
  parseChannelSubject,
} from "@yoizen/shared";
import type {
  ChannelEnvelope,
  WorkflowTrigger,
  Channel,
  ChannelProvider,
} from "@yoizen/shared";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/providers.module";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowsRepository } from "../workflows/workflows.repository";
import type { IWorkflowDefinitionRow } from "../workflows/workflows.repository";

const DURABLE_NAME = "workflow-triggers";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/** `evt.*.channel-service.messaging.*.*.received.v1` — 8-token canonical. */
const TRIGGER_SUBJECT = `${CHANNEL_SUBJECT_PREFIX}.*.${CHANNEL_PRODUCER}.${CHANNEL_DOMAIN}.*.*.received.v1`;

/**
 * Consumes `channel.message.received` events from JetStream and starts
 * matching `message_received` workflow triggers.
 *
 * Triggers are idempotent: the Temporal workflowId is derived from
 * `envelope.idempotencykey + def.id`, so redelivery by JetStream OR a
 * race between replicas results in `WorkflowExecutionAlreadyStartedError`
 * on every attempt after the first — which we silently acknowledge.
 */
@Injectable()
export class TriggerConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(
    TriggerConsumerService.name,
  );
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    private readonly workflowsService: WorkflowsService,
    private readonly workflowsRepository: WorkflowsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: TRIGGER_SUBJECT,
      description:
        "Workflow triggers — message_received → Temporal workflow start",
      metrics: createNatsConsumerMetrics("workflow-service"),
      // Each trigger boots a Temporal workflow over gRPC — I/O bound.
      runnerOptions: { concurrency: 16 },
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleJsMessage(msg),
      this.logger,
    );
    await this.manager.start();
    this.logger.log(
      `Workflow triggers durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  private async handleJsMessage(msg: JsMsg): Promise<void> {
    await this.handleMessage({ subject: msg.subject, data: msg.data });
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

    const payload: Record<string, unknown> =
      (envelope.data?.payload as Record<string, unknown> | null | undefined) ??
      (envelope.data as unknown as Record<string, unknown>);

    const request: Record<string, unknown> = {
      envelope: payload,
      channel,
      provider,
      from: payload.from,
      text: payload.text,
      messageId: envelope.id,
      tenantId: tenant,
    };

    const baseIdempotencyKey = envelope.idempotencykey;

    for (let i = 0; i < toExecute.length; i++) {
      const def = toExecute[i]!;
      const triggerIdempotencyKey = baseIdempotencyKey
        ? `${baseIdempotencyKey}:${def.id}`
        : undefined;
      try {
        const result = await this.workflowsService.executeWorkflow(
          def.id,
          tenant,
          request,
          triggerIdempotencyKey
            ? { idempotencyKey: triggerIdempotencyKey }
            : undefined,
        );
        if (result.alreadyStarted) {
          this.logger.log(
            `Duplicate trigger for workflow ${def.name} (${def.id}) — temporal=${result.temporalWorkflowId} already started`,
          );
        } else {
          this.logger.log(
            `Triggered workflow ${def.name} (${def.id}) -> execution ${result.executionId}`,
          );
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to trigger workflow ${def.id}: ${err instanceof Error ? err.message : err}`,
        );
        throw err instanceof Error
          ? err
          : new Error(`Failed to trigger workflow ${def.id}`);
      }
    }
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

      const payload: Record<string, unknown> =
        (envelope.data?.payload as Record<string, unknown> | null | undefined) ??
        (envelope.data as unknown as Record<string, unknown>);

      const cfg = trigger.config;

      if (cfg.accountIds && cfg.accountIds.length > 0) {
        const incomingAccountId = payload.accountId as string | undefined;

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
        const text = (payload.text as string | undefined) ?? "";

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
