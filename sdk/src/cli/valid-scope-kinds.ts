import type { SecretScopeKind } from "../resources/secrets/index.js";

/**
 * Single source of truth for the `SecretScopeKind` values the CLI treats as
 * valid `spec.secrets[].scope.kind` / `secrets put --scope <kind>:<owner>`
 * inputs. Previously duplicated between `parse-scope-arg.ts` and
 * `extract-secret-bindings.ts` (flagged as a follow-up in
 * `manual-loops/samples-reorg.md` T05); folded into one constant here per
 * `manual-loops/provisioning-manifest-gaps.md` T07.
 *
 * DRIFT GUARD: the SDK has zero runtime dependencies (see
 * `sdk/src/resources/manifests/types.ts` header) and cannot import
 * `@yoizen/shared`'s `secretScopeKindSchema`
 * (`packages/shared/src/provisioning/manifest.schema.ts`), so this list is a
 * hand-kept mirror, not a derived one. Keep it in sync manually:
 *
 * - `channel` / `connector` / `agent` / `service` / `workflow` — always
 *   valid, unchanged since `declarative-provisioning.md`.
 * - `mcpServer` (T07, provisioning-manifest-gaps.md) — added because T06's
 *   `mcpServer` section DOES bind secrets to it: `auth` (bearer/api-key/
 *   basic) and `headers` values both accept a nested `{ secretRef }` form,
 *   and `validate-structural-rules.ts` checks that referencing secretRef's
 *   `spec.secrets[]` entry has `scope.kind === "mcpServer"`.
 * - `systemVariable` — DELIBERATELY OMITTED. `secretScopeKindSchema` in
 *   `@yoizen/shared` gained this member in T04 only so `ResourceKind` (which
 *   is literally `= SecretScopeKind` server-side, see
 *   `services/provisioning-service/src/modules/plan/domain/plan.interfaces.ts`)
 *   could carry `systemVariables` through the generic plan/apply pipeline —
 *   NOT to enable secret-scope bindings to a systemVariable owner. The
 *   manifest schema rejects `systemVariables[].type: "secret"` entirely
 *   (`manifest.schema.ts`'s `systemVariableSchema`), so no system variable
 *   can ever declare a nested `secretRef`, and nothing in
 *   `validate-structural-rules.ts` ever expects a
 *   `scope.kind === "systemVariable"` binding. A manifest declaring one
 *   would be schema-valid but semantically inert (an orphan binding no
 *   writer or resolver ever consumes) — the CLI rejects it up front with a
 *   precise error instead of silently accepting a meaningless binding.
 * - `skill` (T01, manual-loops/provisioning-manifest-gaps-3.md, workstream a)
 *   — DELIBERATELY OMITTED, mirroring the `systemVariable` rationale above
 *   EXACTLY. `secretScopeKindSchema` in `@yoizen/shared` gained this member
 *   in T01 only so `ResourceKind` (literally `= SecretScopeKind` server-side)
 *   could carry `skills` through the generic plan/apply pipeline — NOT to
 *   enable secret-scope bindings to a skill owner. No field in
 *   `skillSchema` is credential-capable (verified against every field in
 *   `CreateSkillDto`/`UpdateSkillDto` — no auth/token/key/secret field
 *   anywhere), so no skill ever declares a nested `secretRef`, and nothing
 *   in `validate-structural-rules.ts` ever expects a
 *   `scope.kind === "skill"` binding. A manifest declaring one would be
 *   schema-valid but semantically inert — the CLI rejects it up front with a
 *   precise error instead of silently accepting a meaningless binding.
 */
export const VALID_SCOPE_KINDS: readonly SecretScopeKind[] = [
  "channel",
  "connector",
  "agent",
  "service",
  "mcpServer",
  "workflow",
];
