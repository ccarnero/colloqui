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
  isWorkerMode,
  resolveServiceName,
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
import {
  WORKFLOWS_REPOSITORY,
  type IWorkflowDefinitionRow,
  type IWorkflowsRepository,
} from "../workflows/workflows.repository.interface";

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
    @Inject(WORKFLOWS_REPOSITORY)
    private readonly workflowsRepository: IWorkflowsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: TRIGGER_SUBJECT,
      description:
        "Workflow triggers — message_received → Temporal workflow start",
      metrics: createNatsConsumerMetrics(resolveServiceName("workflow-service")),
      // 2026-05-22 post-mortem (`post-mortem/POST-MORTEM.md` §P1.1):
      // dropped from 16 → 8 because concurrency=16 was over-amplifying
      // the redelivery storm during Temporal/Postgres slowdowns
      // (6 983 duplicate triggers vs 1 626 uniques, ~4.3× redelivery).
      // Each trigger boots a Temporal workflow over gRPC — I/O bound —
      // so 8 is still ample throughput once the persistence layer is
      // healthy. Revert toward 16 only after the post-mortem regression
      // gates pass under load.
      runnerOptions: { concurrency: 8 },
      // Tighter delivery semantics: starting a workflow is idempotent
      // (`workflowId = <tenant>:<name>:<idempotencykey>:<defId>`), so
      // 3 retries cover transient gRPC blips without amplifying the
      // workflow population during a backend slowdown. Default of 5
      // could 5× the workflow count under load.
      // Note: NATS requires maxDeliver > backoff.length, so we pair
      // maxDeliver=3 with a 2-entry backoff [10s, 30s].
      maxDeliver: 3,
      // 2026-05-22 post-mortem (§P1.1): raised 30s → 60s to match the
      // observed worst-case `StartWorkflowExecution` p99 (~10s) PLUS
      // headroom for an in-flight retry. The previous 30s fired before
      // the first attempt returned during the cascade, triggering
      // immediate redelivery and amplifying load on Temporal.
      ackWaitMs: 60_000,
      // 2026-05-22 post-mortem follow-up: NATS server REWRITES
      // `ack_wait` to `backoff[0]` when a backoff array is present
      // (see `packages/database/src/nats-durable-consumer.ts` lines
      // 31-42 and the `DEFAULT_BACKOFF_MS` table). With our previous
      // `[10_000, 30_000]` the consumer effectively had a 10s ack-wait
      // and was redelivering long before `client.workflow.start` could
      // return under load (dup/trig observed at 5.6x in a re-run).
      // `backoff[0]` MUST equal `ackWaitMs`. With `maxDeliver: 3` and
      // the last entry reused once exhausted, total time-to-DLQ =
      // 60s + 120s + 120s = 5 min — well within the workflow timeout
      // budget and aligned with the platform defaults.
      backoffMs: [60_000, 120_000],
      ensureOnly,
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
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Workflow triggers durable consumer ('${DURABLE_NAME}') started`,
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

    /**
     * Causal chain snapshot from the triggering envelope (wdocs-02 §6).
     * Passed to every workflow started from this message so publishing
     * activities can emit derived envelopes with `causation_id`,
     * `correlation_id`, and `transport.depth` correctly inherited.
     * Falls back gracefully when an older envelope omits any of the
     * three so no regression is introduced for pre-migration events.
     */
    const incomingDepth = envelope.transport?.depth;
    const causal =
      typeof envelope.id === "string" &&
      typeof envelope.correlation_id === "string"
        ? {
            causation_id: envelope.id,
            correlation_id: envelope.correlation_id,
            depth: typeof incomingDepth === "number" ? incomingDepth : 0,
          }
        : undefined;

    for (let i = 0; i < toExecute.length; i++) {
      const def = toExecute[i]!;
      const triggerIdempotencyKey = baseIdempotencyKey
        ? `${baseIdempotencyKey}:${def.id}`
        : undefined;
      try {
        const options =
          triggerIdempotencyKey || causal
            ? {
                ...(triggerIdempotencyKey && {
                  idempotencyKey: triggerIdempotencyKey,
                }),
                ...(causal && { causal }),
              }
            : undefined;
        const result = await this.workflowsService.executeWorkflow(
          def.id,
          tenant,
          request,
          options,
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
