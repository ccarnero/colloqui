import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  AGENT_AI_EXECUTION_COMPLETED,
  AGENT_AI_EXECUTION_FAILED,
  AGENT_AI_EXECUTION_STARTED,
  AGENT_AI_PRODUCER,
  buildEventEnvelope,
  buildPlatformSubject,
  deriveEnvelope,
  type EventEnvelope,
} from "@yoizen/shared";
import type { NatsConnection } from "nats";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { AgentTaskService } from "./actions/agent-task.service";
import { FunctionActionService } from "./actions/function-action.service";
import { LlmActionService } from "./actions/llm-action.service";
import { WebhookActionService } from "./actions/webhook-action.service";

export interface JobTriggerPayload {
  readonly jobId: string;
  readonly executionId?: string;
  readonly eventPayload?: Record<string, unknown>;
}

export interface JobExecutionResult {
  readonly executionId: string;
  readonly jobId: string;
  readonly tenantId: string;
  readonly status: "completed" | "failed";
  readonly result?: Record<string, unknown>;
  readonly error?: string;
}

/** The three execution lifecycle events this service reports. */
type ExecutionStatusKind =
  | "execution_started"
  | "execution_completed"
  | "execution_failed";

/**
 * Lifecycle kind -> shared subject template.
 *
 * Same family, same constants and same reasoning as
 * `nats-handlers/execution.handler.ts`: token 2 of the subject is the producer
 * routing key and it now says `agent-ai-service`, matching the envelope this
 * method stamps (2026-08-07, `PENDIENTES/04-e3-subject.spec.md` / E3). It used
 * to be a hardcoded `ai-agent-gateway` literal.
 */
const EXECUTION_STATUS_SUBJECTS: Record<ExecutionStatusKind, string> = {
  execution_started: AGENT_AI_EXECUTION_STARTED,
  execution_completed: AGENT_AI_EXECUTION_COMPLETED,
  execution_failed: AGENT_AI_EXECUTION_FAILED,
};

@Injectable()
export class JobExecutorService {
  private readonly logger = new PinoLoggerService(JobExecutorService.name);

  constructor(
    private readonly llmAction: LlmActionService,
    private readonly webhookAction: WebhookActionService,
    private readonly functionAction: FunctionActionService,
    private readonly agentTask: AgentTaskService,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  async executeJob(
    tenantId: string,
    payload: JobTriggerPayload,
    envelope?: EventEnvelope
  ): Promise<JobExecutionResult> {
    const executionId = payload.executionId ?? crypto.randomUUID();
    const { jobId } = payload;

    this.logger.log(
      `[job-executor] Starting: tenant='${tenantId}' job='${jobId}' execution='${executionId}'`
    );

    await this.publishStatus(
      tenantId,
      "execution_started",
      { executionId, jobId, tenantId, status: "started" },
      envelope
    );

    try {
      const jobConfig = payload.eventPayload ?? {};
      const actionType = String(jobConfig.action_type ?? "").trim();
      const actionConfig =
        (jobConfig.action_config as Record<string, unknown>) ?? {};
      const agentId = String(jobConfig.agent_id ?? jobId);
      const variables = (jobConfig.variables as Record<string, unknown>) ?? {};

      let result: Record<string, unknown>;

      switch (actionType) {
        case "llm_call":
          result = {
            ...(await this.llmAction.execute(
              tenantId,
              agentId,
              actionConfig,
              variables,
              executionId,
              envelope
            )),
          };
          break;
        case "webhook":
          result = {
            ...(await this.webhookAction.execute(
              tenantId,
              actionConfig,
              jobConfig
            )),
          };
          break;
        case "function":
          result = {
            ...(await this.functionAction.execute(
              String(actionConfig.function ?? ""),
              (actionConfig.parameters as Record<string, unknown>) ?? {}
            )),
          };
          break;
        case "agent_task":
          return this.handleAgentTask(
            tenantId,
            agentId,
            executionId,
            jobId,
            jobConfig,
            envelope
          );
        default:
          throw new Error(`Unknown action type: '${actionType}'`);
      }

      await this.publishStatus(
        tenantId,
        "execution_completed",
        {
          executionId,
          jobId,
          tenantId,
          status: "completed",
          result,
        },
        envelope
      );

      this.logger.log(
        `[job-executor] Completed: execution='${executionId}' job='${jobId}'`
      );

      return {
        executionId,
        jobId,
        tenantId,
        status: "completed",
        result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.publishStatus(
        tenantId,
        "execution_failed",
        {
          executionId,
          jobId,
          tenantId,
          status: "failed",
          error: errorMessage,
        },
        envelope
      );

      this.logger.error(
        `[job-executor] Failed: execution='${executionId}' job='${jobId}': ${errorMessage}`
      );

      return {
        executionId,
        jobId,
        tenantId,
        status: "failed",
        error: errorMessage,
      };
    }
  }

  async handleObservation(
    tenantId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const eventName = String(payload.event_name ?? "");
    const eventPayload =
      (payload.event_payload as Record<string, unknown>) ?? {};

    this.logger.log(
      `[job-executor] Observation event: tenant='${tenantId}' event='${eventName}'`
    );

    const triggerPayload: JobTriggerPayload = {
      jobId: String(payload.job_id ?? ""),
      executionId: payload.execution_id as string | undefined,
      eventPayload: {
        ...eventPayload,
        action_type: eventPayload.action_type ?? "function",
        action_config: eventPayload.action_config ?? {},
      },
    };

    if (!triggerPayload.jobId) {
      this.logger.warn(
        `[job-executor] Observation missing job_id for tenant '${tenantId}'`
      );
      return;
    }

    await this.executeJob(tenantId, triggerPayload);
  }

  private async handleAgentTask(
    tenantId: string,
    agentId: string,
    executionId: string,
    jobId: string,
    jobConfig: Record<string, unknown>,
    envelope?: EventEnvelope
  ): Promise<JobExecutionResult> {
    const actionConfig =
      (jobConfig.action_config as Record<string, unknown>) ?? {};
    const result = await this.agentTask.execute(
      tenantId,
      agentId,
      actionConfig
    );

    await this.publishStatus(
      tenantId,
      result.success ? "execution_completed" : "execution_failed",
      {
        executionId,
        jobId,
        tenantId,
        status: result.success ? "completed" : "failed",
        result: result.result,
        error: result.error,
      },
      envelope
    );

    this.logger.log(
      `[job-executor] Agent task ${result.success ? "completed" : "failed"}: execution='${executionId}' job='${jobId}'`
    );

    return {
      executionId,
      jobId,
      tenantId,
      status: result.success ? "completed" : "failed",
      result: result.result,
      error: result.error,
    };
  }

  private async publishStatus(
    tenantId: string,
    kind: ExecutionStatusKind,
    data: Record<string, unknown>,
    incoming?: EventEnvelope
  ): Promise<void> {
    try {
      const event = incoming
        ? deriveEnvelope(incoming, {
            id: crypto.randomUUID(),
            type: `io.yoizen.platform.runtime.${kind}.v1`,
            source: `agent-ai-service/execution/${data.executionId ?? "unknown"}`,
            resource: `execution/${data.executionId ?? "unknown"}`,
            // Without this override `deriveEnvelope` inherits the REQUESTER's
            // producer (`ai-agent-gateway`) — the envelope would credit the
            // caller for an event this service produced. Overridden at the
            // call site so the shared inheritance semantics stay untouched
            // (E3, PENDIENTES/04-e3-subject.spec.md).
            producer: AGENT_AI_PRODUCER,
            payload: data,
          })
        : buildEventEnvelope({
            type: `io.yoizen.platform.runtime.${kind}.v1`,
            source: `agent-ai-service/execution/${data.executionId ?? "unknown"}`,
            resource: `execution/${data.executionId ?? "unknown"}`,
            tenant: tenantId,
            producer: AGENT_AI_PRODUCER,
            domain: "automation",
            channel: "platform",
            provider: "internal",
            accountid: "",
            payload: data,
          });

      const subject = buildPlatformSubject(
        EXECUTION_STATUS_SUBJECTS[kind],
        tenantId
      );
      this.logger.debug(
        `[job-executor] Publishing ${kind} on '${subject}' (producer='${AGENT_AI_PRODUCER}')`
      );
      this.nc.publish(subject, JSON.stringify(event));
    } catch (pubError) {
      this.logger.warn(`[job-executor] Failed to publish ${kind}: ${pubError}`);
    }
  }
}
