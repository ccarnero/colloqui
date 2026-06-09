import { Injectable } from "@nestjs/common";
import type { JsMsg } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import type { EventEnvelope } from "@yoizen/shared";
import { ChatHandler } from "../../nats-handlers/chat.handler";
import { ExecutionHandler } from "../../nats-handlers/execution.handler";
import { ConfigSyncHandler } from "../../nats-handlers/config-sync.handler";
import { JobTriggerHandler } from "../../nats-handlers/job-trigger.handler";
import { JobEventHandler } from "../../nats-handlers/job-event.handler";
import { AgentPublishedHandler } from "../../nats-handlers/agent-published.handler";
import { HeartbeatService } from "../heartbeat/heartbeat.service";
import { DepthTrackerService } from "../depth-tracker/depth-tracker.service";

type ActionType =
  | "config_sync"
  | "jobs_sync"
  | "job_trigger"
  | "chat_respond"
  | "agent_outbound"
  | "execution_requested"
  | "agent_published"
  | "agent_unpublished"
  | "agent_observation"
  | "skill_changed";

@Injectable()
export class MessageRouterService {
  private readonly logger = new PinoLoggerService(MessageRouterService.name);

  constructor(
    private readonly chatHandler: ChatHandler,
    private readonly executionHandler: ExecutionHandler,
    private readonly configSyncHandler: ConfigSyncHandler,
    private readonly jobTriggerHandler: JobTriggerHandler,
    private readonly jobEventHandler: JobEventHandler,
    private readonly agentPublishedHandler: AgentPublishedHandler,
    private readonly heartbeat: HeartbeatService,
    private readonly depthTracker: DepthTrackerService,
  ) {}

  async route(msg: JsMsg): Promise<void> {
    const raw = new TextDecoder().decode(msg.data);
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(raw) as EventEnvelope;
    } catch {
      this.logger.error(`Failed to parse message on subject '${msg.subject}'`);
      return;
    }

    const actionType = this.extractActionType(envelope, msg.subject);
    const tenantId = envelope.tenant ?? "unknown";
    const payload = (envelope.data?.payload ?? {}) as Record<string, unknown>;

    this.logger.log(
      `Received event: type='${envelope.type}' action='${actionType}' tenant='${tenantId}' subject='${msg.subject}'`,
    );

    this.heartbeat.markTenantActive(tenantId);

    this.depthTracker.enforceDepthLimit(envelope as unknown as Record<string, unknown>);

    switch (actionType) {
      case "config_sync":
        await this.configSyncHandler.handle(tenantId, payload, envelope, "config_sync");
        break;
      case "jobs_sync":
        await this.configSyncHandler.handle(tenantId, payload, envelope, "jobs_sync");
        break;
      case "job_trigger":
        await this.jobTriggerHandler.handle(tenantId, payload, envelope);
        break;
      case "chat_respond":
      case "agent_outbound":
        await this.chatHandler.handle(tenantId, payload);
        break;
      case "execution_requested":
        await this.executionHandler.handle(tenantId, payload, envelope);
        break;
      case "agent_published":
        await this.agentPublishedHandler.handle(tenantId, payload, envelope, "agent_published");
        break;
      case "agent_unpublished":
        await this.agentPublishedHandler.handle(tenantId, payload, envelope, "agent_unpublished");
        break;
      case "agent_observation":
        await this.jobEventHandler.handle(tenantId, payload, envelope);
        break;
      case "skill_changed":
        this.logger.log(
          `Skill changed event: tenant='${tenantId}' skillId='${String(payload.skillId ?? "")}' action='${String(payload.action ?? "")}'`,
        );
        break;
      default:
        this.logger.warn(`Unknown action type '${actionType}' on subject '${msg.subject}'`);
    }
  }

  private extractActionType(envelope: EventEnvelope, subject: string): ActionType {
    // Extract from subject: evt.{tenant}.<producer>.automation.platform.internal.<action>.v1
    const subjectParts = subject.split(".");
    if (subjectParts.length >= 3) {
      const action = subjectParts[subjectParts.length - 2];
      if (action && action !== ">") return action as ActionType;
    }

    // Fallback: extract from envelope type
    const type = envelope.type ?? "";
    const parts = type.split(".");
    const action = parts[parts.length - 2];
    return (action ?? "unknown") as ActionType;
  }
}
