/**
 * `@yoizen/platform-sdk/structured-kb` — the `structuredKb` resource client.
 * See sdk/README.md "Resource clients" for the pattern this follows (from
 * the `workflows` reference implementation).
 */

export type {
  StructuredKbCallOptions,
  StructuredKbClient,
  StructuredKbClientDeps,
  StructuredKbContainersClient,
} from "./client.js";
export { createStructuredKbClient } from "./client.js";
export type {
  CreateSKBContainerInput,
  QuerySKBContainerInput,
  QuerySKBContainerResult,
  SKBContainer,
  SKBContainerStatus,
  UpdateSKBContainerInput,
  UploadSKBFileInput,
  UploadSKBFileResult,
} from "./types.js";
