import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  buildEventEnvelope,
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
    kind: string,
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
            payload: data,
          })
        : buildEventEnvelope({
            type: `io.yoizen.platform.runtime.${kind}.v1`,
            source: `agent-ai-service/execution/${data.executionId ?? "unknown"}`,
            resource: `execution/${data.executionId ?? "unknown"}`,
            tenant: tenantId,
            producer: "agent-ai-service",
            domain: "automation",
            channel: "platform",
            provider: "internal",
            accountid: "",
            payload: data,
          });

      const subject = `evt.${tenantId}.ai-agent-gateway.automation.platform.internal.${kind}.v1`;
      this.nc.publish(subject, JSON.stringify(event));
    } catch (pubError) {
      this.logger.warn(`[job-executor] Failed to publish ${kind}: ${pubError}`);
    }
  }
}
