import { Module } from "@nestjs/common";
import { KnowledgeBaseSearchService } from "./knowledge-base-search.service";

@Module({
  providers: [KnowledgeBaseSearchService],
  exports: [KnowledgeBaseSearchService],
})
export class KnowledgeBasesModule {}
