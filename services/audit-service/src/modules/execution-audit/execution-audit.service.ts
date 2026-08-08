import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { context as otelContext } from "@opentelemetry/api";
import {
  type IMultiTenantConsumerConfig,
  MultiTenantConsumerManager,
} from "@yoizen/database";
import {
  createNatsConsumerMetrics,
  isWorkerMode,
  logWithEnvelope,
  PinoLoggerService,
  resolveServiceName,
  startNatsConsumerSpan,
} from "@yoizen/observability";
import {
  AGENT_AI_EXECUTION_COMPLETED,
  AGENT_AI_EXECUTION_FAILED,
  AGENT_AI_EXECUTION_STARTED,
  type EventEnvelope,
} from "@yoizen/shared";
import type { JetStreamClient, JetStreamManager, JsMsg } from "nats";
import type {
  IExecutionLifecyclePayload,
  IStoredExecutionEvent,
} from "../../common/execution-audit-projection";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import {
  EXECUTION_AUDIT_REPOSITORY,
  type IExecutionAuditQueryParams,
  type IExecutionAuditRepository,
} from "./execution-audit.repository.interface";

export type { IStoredExecutionEvent };

const DURABLE_NAME = "execution-audit";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
const HANDLER_CONCURRENCY = 16;

/**
 * Automation-domain execution lifecycle subjects, tenant-wildcarded for the
 * per-tenant `INGRESS-<tenant>` consumer filter (DOCS/archive/audits/METERING-FOUNDATION.md
 * G1/G2). The canonical `audit-events` consumer (`audit.service.ts`) only
 * matches `evt.*.*.platform.>` — the `automation` domain used by these
 * subjects falls outside that pattern, which is exactly the audit blind spot
 * this dedicated consumer closes.
 *
 * The producer token of these three subjects moved from `ai-agent-gateway` to
 * `agent-ai-service` on 2026-08-07 (`PENDIENTES/04-e3-subject.spec.md` / E3) —
 * the runtime that publishes them. `ensureDurableConsumer` does NOT reconcile
 * `filter_subjects` on an existing durable, so the `execution-audit` durables
 * created before that date must be deleted once for the new filter to apply.
 */
const EXECUTION_LIFECYCLE_SUBJECTS = [
  AGENT_AI_EXECUTION_STARTED,
  AGENT_AI_EXECUTION_COMPLETED,
  AGENT_AI_EXECUTION_FAILED,
].map((template) => template.replace("{tenant}", "*"));

@Injectable()
export class ExecutionAuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(ExecutionAuditService.name);
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(EXECUTION_AUDIT_REPOSITORY)
    private readonly executionAuditRepository: IExecutionAuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubjects: EXECUTION_LIFECYCLE_SUBJECTS,
      description: "Automation-domain execution lifecycle audit writer",
      metrics: createNatsConsumerMetrics(resolveServiceName("audit-service")),
      runnerOptions: { concurrency: HANDLER_CONCURRENCY },
      ensureOnly,
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleJsMessage(msg),
      this.logger
    );
    await this.manager.start();
    this.logger.log(
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Execution audit durable consumer ('${DURABLE_NAME}') started`
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  private async handleJsMessage(msg: JsMsg): Promise<void> {
    const envelope = JSON.parse(
      new TextDecoder().decode(msg.data)
    ) as EventEnvelope;

    const incomingHeaders = msg.headers ?? {
      keys: () => [],
      values: () => [],
      get: () => "",
      set: () => {},
    };
    const { span, context: ctx } = startNatsConsumerSpan(
      resolveServiceName("audit-service"),
      msg.subject,
      incomingHeaders
    );
    try {
      await otelContext.with(ctx, () =>
        this.persistExecutionEnvelope(envelope, msg.subject)
      );
    } finally {
      span.end();
    }
  }

  private async persistExecutionEnvelope(
    envelope: EventEnvelope,
    natsSubject: string
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) {
      logWithEnvelope(
        this.logger,
        envelope,
        "execution-audit.dropped",
        "Dropping execution event: missing tenant",
        "warn"
      );
      return;
    }

    const payload = envelope.data?.payload as unknown as
      | IExecutionLifecyclePayload
      | null
      | undefined;
    if (!payload?.executionId || !payload.state) {
      logWithEnvelope(
        this.logger,
        envelope,
        "execution-audit.dropped",
        "Dropping execution event: missing executionId/state in payload",
        "warn"
      );
      return;
    }

    await this.executionAuditRepository.insertExecutionEvent(
      envelope,
      payload,
      natsSubject
    );
    logWithEnvelope(
      this.logger,
      envelope,
      "execution-audit.persist.ok",
      `Execution event persisted (subject=${natsSubject})`
    );
  }

  async queryEvents(
    params: IExecutionAuditQueryParams,
    tenantId: string
  ): Promise<IStoredExecutionEvent[]> {
    return this.executionAuditRepository.queryEvents(params, tenantId);
  }

  async getEventById(
    id: string,
    tenantId: string
  ): Promise<IStoredExecutionEvent | null> {
    return this.executionAuditRepository.getEventById(id, tenantId);
  }
}
