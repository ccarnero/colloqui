/**
 * `@yoizen/platform-sdk/memories` — the `memories` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  MemoriesCallOptions,
  MemoriesClient,
  MemoriesClientDeps,
} from "./client.js";
export { createMemoriesClient } from "./client.js";
export type {
  CreateMemoryInput,
  ListMemoriesParams,
  ListMemoryProposalsParams,
  Memory,
  MemoryKind,
  MemoryScope,
  MemoryStatus,
  UpdateMemoryInput,
} from "./types.js";
