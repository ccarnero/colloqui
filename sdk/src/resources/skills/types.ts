/**
 * Request/response types for the `skills` resource (`admin/skills`),
 * hand-typed against the REAL gateway + downstream shapes (verified
 * 2026-07-04, see sdk/GROWTH-PLAN.md Phase 2):
 *
 * - `services/api-gateway/src/modules/admin/admin-skills.controller.ts`
 *   (`AdminSkillsController`, raw passthrough proxy via `AdminProxyService`).
 * - `services/agent-admin-service/src/modules/skills/skills.controller.ts` +
 *   `skills.service.ts` (`ISkill`, `ISkillFile`) for the real
 *   validated/persisted shape.
 * - `services/agent-admin-service/src/modules/skills/skills.dto.ts`
 *   (`CreateSkillDto`, `UpdateSkillDto`, `SkillFileDto`).
 *
 * Known gaps / gotchas:
 *
 * - `GET /admin/skills` — the gateway forwards `limit`/`offset` query params
 *   (`admin-skills.controller.ts` `findAll`), but the downstream
 *   `SkillsService.findAll(tenantId)` takes NO limit/offset params and always
 *   returns every active skill plus `total: skills.length` (i.e. `total`
 *   always equals `items.length`, there is no real slicing). `list()` still
 *   adapts through `toOffsetPage()` for a consistent, forward-compatible
 *   shape — see the identical gap on `knowledgeBases.list()` for the full
 *   explanation.
 * - `GET /admin/skills/:id`, `PATCH /admin/skills/:id` — the downstream
 *   service returns `null` (not a 404) when the id doesn't exist
 *   (`findById`/`update` return `skill ?? null`, and `SkillsController`
 *   doesn't throw on a `null` result). `get()`/`update()` are typed
 *   `Promise<Skill | null>` — callers must null-check, they will NOT see a
 *   `NotFoundError`.
 * - `DELETE /admin/skills/:id` — soft-delete; downstream returns a bare
 *   boolean (`result.length > 0`), not an object, not a 404 on missing id.
 *   `remove()` is typed `Promise<boolean>`.
 * - **STALE NOTE, CORRECTED (T04, manual-loops/provisioning-manifest-gaps-3.md
 *   decision 5) — the bug below is FIXED server-side.** This section
 *   previously documented a 2026-07-04 finding that `PATCH /admin/skills/:id`
 *   returned HTTP 500 for every payload, root-caused to `SkillsService.update`
 *   (`skills.service.ts`) joining `postgres.js` tagged-template fragments via
 *   `Array.prototype.join`, which stringifies each fragment with
 *   `String(fragment)` instead of preserving its parameterization — a
 *   malformed, unparameterized query. The CURRENT `skills.service.ts:144-215`
 *   uses the CORRECT fragment-nesting pattern
 *   (`sql\`${setClause}, col = ${value}\``, no cast, no `.join()`) — its own
 *   comment explicitly contrasts against the old join anti-pattern. LIVE
 *   PROBE (orchestrator, 2026-07-17, decisive): created a skill, `PATCH`ed it
 *   via the gateway -> HTTP 200, field updated, cleanup 200. So
 *   `client.skills.update()` is a NORMAL, working update path — no
 *   special-casing, no "expect the 500". `test/e2e/admin-resources.e2e.ts`
 *   already asserts the FIXED (successful) behavior, confirmed live on the
 *   dev cluster 2026-07-05 and again 2026-07-17 — see that test's own
 *   comment. Nothing to flip; this note only corrects the stale narrative
 *   above (no test change).
 */

export interface SkillFile {
  name: string;
  path: string;
  type: "script" | "reference" | "asset";
  content: string;
}

/** Response shape for create/get/list items/update (`ISkill`). */
export interface Skill {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  icon: string;
  color: string;
  trigger_commands: string[];
  when_to_use: string;
  priority: number;
  allowed_tools: string[];
  mode: string;
  files: SkillFile[];
  metadata: Record<string, unknown>;
  is_active: boolean;
  /** ISO-8601 timestamp (serialized `Date`). */
  created_at: string;
  /** ISO-8601 timestamp (serialized `Date`). */
  updated_at: string;
}

/** `POST /admin/skills` body (mirrors `CreateSkillDto`). */
export interface CreateSkillInput {
  name: string;
  description?: string;
  system_prompt: string;
  icon?: string;
  color?: string;
  trigger_commands?: string[];
  when_to_use?: string;
  priority?: number;
  allowed_tools?: string[];
  mode?: "router" | "llm_driven" | "inline";
  files?: SkillFile[];
}

/** `PATCH /admin/skills/:id` body (mirrors `UpdateSkillDto`). */
export interface UpdateSkillInput {
  name?: string;
  description?: string;
  system_prompt?: string;
  icon?: string;
  color?: string;
  trigger_commands?: string[];
  when_to_use?: string;
  priority?: number;
  allowed_tools?: string[];
  mode?: "router" | "llm_driven" | "inline";
  files?: SkillFile[];
  is_active?: boolean;
}

export interface ListSkillsParams {
  /** Page size sent as `limit`; see the ignored-downstream gap note above. Default 50. */
  pageSize?: number;
  /** Item offset sent as `offset`; see the ignored-downstream gap note above. Default 0. */
  startOffset?: number;
}

/** Raw envelope returned by `GET /admin/skills` (`{ skills, total }`). */
export interface ListSkillsPage {
  skills: Skill[];
  total: number;
}
