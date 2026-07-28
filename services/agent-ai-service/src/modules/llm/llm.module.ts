import { Module } from "@nestjs/common";
import { KnowledgeBasesModule } from "../knowledge-bases/knowledge-bases.module";
import { CostTrackerService } from "./cost-tracker.service";
import { CredentialResolverService } from "./credential-resolver.service";
import { EmbeddingService } from "./embedding.service";
import { LlmCallEventPublisherService } from "./llm-call-event-publisher.service";
import { LlmExecutorService } from "./llm-executor.service";
import { ProviderRegistryService } from "./provider-registry.service";

@Module({
  imports: [KnowledgeBasesModule],
  providers: [
    ProviderRegistryService,
    CredentialResolverService,
    CostTrackerService,
    LlmExecutorService,
    EmbeddingService,
    LlmCallEventPublisherService,
  ],
  exports: [
    LlmExecutorService,
    CostTrackerService,
    EmbeddingService,
    LlmCallEventPublisherService,
  ],
})
export class LlmModule {}
