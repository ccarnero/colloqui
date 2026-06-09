import { Module } from "@nestjs/common";
import { ProviderRegistryService } from "./provider-registry.service";
import { CredentialResolverService } from "./credential-resolver.service";
import { LlmExecutorService } from "./llm-executor.service";
import { CostTrackerService } from "./cost-tracker.service";
import { EmbeddingService } from "./embedding.service";
import { KnowledgeBasesModule } from "../knowledge-bases/knowledge-bases.module";

@Module({
  imports: [KnowledgeBasesModule],
  providers: [
    ProviderRegistryService,
    CredentialResolverService,
    CostTrackerService,
    LlmExecutorService,
    EmbeddingService,
  ],
  exports: [LlmExecutorService, CostTrackerService, EmbeddingService],
})
export class LlmModule {}
