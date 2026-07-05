/**
 * `@yoizen/platform-sdk/skills` — the `skills` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  SkillCallOptions,
  SkillsClient,
  SkillsClientDeps,
} from "./client.js";
export { createSkillsClient } from "./client.js";
export type {
  CreateSkillInput,
  ListSkillsPage,
  ListSkillsParams,
  Skill,
  SkillFile,
  UpdateSkillInput,
} from "./types.js";
