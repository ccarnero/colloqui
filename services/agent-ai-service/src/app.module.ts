import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { NatsConsumerModule } from "./modules/nats-consumer/nats-consumer.module";
import { HealthModule } from "./modules/health/health.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { ChatModule } from "./modules/chat/chat.module";
import { LlmModule } from "./modules/llm/llm.module";
import { SkillsModule } from "./modules/skills/skills.module";
import { ToolsModule } from "./modules/tools/tools.module";
import { MemoryModule } from "./modules/memory/memory.module";
import { ExecutionModule } from "./modules/execution/execution.module";
import { ConfigSyncModule } from "./modules/config-sync/config-sync.module";
import { JobExecutorModule } from "./modules/job-executor/job-executor.module";
import { HeartbeatModule } from "./modules/heartbeat/heartbeat.module";
import { DepthTrackerModule } from "./modules/depth-tracker/depth-tracker.module";
import { TemplateRendererModule } from "./modules/template-renderer/template-renderer.module";
import { SchedulerModule } from "./modules/scheduler/scheduler.module";
import { ClaimCheckModule } from "./modules/claim-check/claim-check.module";
import { AdminModule } from "./modules/admin/admin.module";
import { RateLimitModule } from "./modules/rate-limit/rate-limit.module";
import { ConditionEvaluatorModule } from "./modules/condition-evaluator/condition-evaluator.module";
import { PromptReferencesModule } from "./modules/prompt-references/prompt-references.module";
import { StateMergerModule } from "./modules/tools/state-merger.module";
import { BackendClientModule } from "./modules/tools/backend-client.module";
import { KnowledgeBasesModule } from "./modules/knowledge-bases/knowledge-bases.module";

@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "agent-ai-service" }),
    ProvidersModule,
    NatsConsumerModule,
    HealthModule,
    AgentsModule,
    ChatModule,
    LlmModule,
    SkillsModule,
    ToolsModule,
    MemoryModule,
    ExecutionModule,
    ConfigSyncModule,
    JobExecutorModule,
    HeartbeatModule,
    DepthTrackerModule,
    TemplateRendererModule,
    SchedulerModule,
    ClaimCheckModule,
    AdminModule,
    RateLimitModule,
    ConditionEvaluatorModule,
    PromptReferencesModule,
    StateMergerModule,
    BackendClientModule,
    KnowledgeBasesModule,
  ],
})
export class AppModule {}
