import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { ChatModule } from "../chat/chat.module";
import { ConfigSyncModule } from "../config-sync/config-sync.module";
import { JobExecutorModule } from "../job-executor/job-executor.module";
import { HeartbeatModule } from "../heartbeat/heartbeat.module";
import { DepthTrackerModule } from "../depth-tracker/depth-tracker.module";
import { MultiTenantConsumerService } from "./multi-tenant-consumer.service";
import { MessageRouterService } from "./message-router.service";
import { ChatHandler } from "../../nats-handlers/chat.handler";
import { ExecutionHandler } from "../../nats-handlers/execution.handler";
import { ConfigSyncHandler } from "../../nats-handlers/config-sync.handler";
import { JobTriggerHandler } from "../../nats-handlers/job-trigger.handler";
import { JobEventHandler } from "../../nats-handlers/job-event.handler";
import { AgentPublishedHandler } from "../../nats-handlers/agent-published.handler";

@Module({
  imports: [
    AgentsModule,
    ChatModule,
    ConfigSyncModule,
    JobExecutorModule,
    HeartbeatModule,
    DepthTrackerModule,
  ],
  providers: [
    ChatHandler,
    ExecutionHandler,
    ConfigSyncHandler,
    JobTriggerHandler,
    JobEventHandler,
    AgentPublishedHandler,
    MultiTenantConsumerService,
    MessageRouterService,
  ],
  exports: [MultiTenantConsumerService, MessageRouterService],
})
export class NatsConsumerModule {}
