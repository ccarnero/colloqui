/**
 * `@yoizen/platform-sdk/knowledge-bases` — the `knowledgeBases` resource
 * client. See sdk/README.md "Resource clients" for the pattern this follows
 * (from the `workflows` reference implementation).
 */

export type {
  KnowledgeBaseCallOptions,
  KnowledgeBaseDocumentsClient,
  KnowledgeBasesClient,
  KnowledgeBasesClientDeps,
} from "./client.js";
export { createKnowledgeBasesClient } from "./client.js";
export type {
  ChunksPage,
  CreateKnowledgeBaseInput,
  DocumentChunk,
  DocumentUploadResult,
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeBaseIngestionConfig,
  ListChunksParams,
  ListDocumentsPage,
  ListKnowledgeBasesPage,
  ListKnowledgeBasesParams,
  UpdateChunkInput,
  UpdateKnowledgeBaseInput,
  UploadDocumentInput,
  UploadFileDocumentInput,
} from "./types.js";
