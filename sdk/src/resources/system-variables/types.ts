/**
 * Request/response types for the `systemVariables` resource
 * (`admin/system-variables`), hand-typed against the REAL gateway +
 * downstream shapes (verified 2026-07-04, see sdk/GROWTH-PLAN.md Phase 2):
 *
 * - `services/api-gateway/src/modules/admin/admin-system-variables.controller.ts`
 *   (`AdminSystemVariablesController`, raw passthrough proxy via
 *   `AdminProxyService`).
 * - `services/agent-admin-service/src/modules/system-variables/system-variables.controller.ts`
 *   + `system-variables.service.ts` (`ISystemVariable`) for the real
 *   validated/persisted shape.
 * - `services/agent-admin-service/src/modules/system-variables/system-variables.dto.ts`
 *   (`CreateSystemVariableDto`, `UpdateSystemVariableDto`).
 *
 * For context only (not touched by this SDK client): these variables are
 * consumed tenant-side by
 * `services/workflow-service/src/modules/workflows/system-variables.provider.ts`,
 * which caches them for 5 minutes.
 *
 * Known gaps / gotchas:
 *
 * - `GET /admin/system-variables` — the gateway forwards `limit`/`offset`
 *   query params (`admin-system-variables.controller.ts` `findAll`), but the
 *   downstream `SystemVariablesService.findAll(tenantId)` takes NO
 *   limit/offset params and always returns every active variable plus the
 *   real `total` count (no slicing happens). `list()` still adapts through
 *   `toOffsetPage()` for a consistent, forward-compatible shape — see the
 *   identical gap on `knowledgeBases.list()` for the full explanation.
 * - `GET /admin/system-variables/:id`, `PATCH /admin/system-variables/:id` —
 *   the downstream service returns `null` (not a 404) when the id doesn't
 *   exist (`findById`/`update` return `row ?? null`, and
 *   `SystemVariablesController` doesn't throw on a `null` result).
 *   `get()`/`update()` are typed `Promise<SystemVariable | null>` — callers
 *   must null-check, they will NOT see a `NotFoundError`.
 * - `DELETE /admin/system-variables/:id` — soft-delete; downstream returns a
 *   bare boolean (`result.length > 0`), not an object, not a 404 on missing
 *   id. `remove()` is typed `Promise<boolean>`.
 * - **Verified live against the dev cluster 2026-07-04**: `value` round-trips
 *   INCONSISTENTLY between `create()` and `update()` for scalar (e.g.
 *   `type: "string"`) payloads:
 *   - `SystemVariablesService.create` (`system-variables.service.ts`) binds
 *     `${JSON.stringify(data.value)}::jsonb` as a normal parameterized
 *     `sql` tagged-template value; for `value: "hello"` this round-trips
 *     DOUBLE-encoded — the response's `value` comes back as the literal
 *     string `'"hello"'` (quotes included), not `'hello'`.
 *   - `SystemVariablesService.update` builds its `SET value = ...::jsonb`
 *     clause as a hand-escaped raw-SQL string
 *     (`esc(JSON.stringify(data.value))`) injected via `sql.unsafe(...)` —
 *     a different code path that, empirically, round-trips correctly
 *     (`value: "updated"` comes back as the bare string `'updated'`).
 *   Reproduced directly via the create/update responses, independent of the
 *   SDK. `value` is typed `unknown` here (matching the downstream DTO)
 *   rather than narrowed by `type`, since the SDK can't correct this
 *   encoding without guessing at intent; per GROWTH-PLAN.md invariants this
 *   should be fixed upstream in `agent-admin-service` (ideally by making
 *   `create` use the same encoding as `update`, or vice versa), not papered
 *   over client-side. `test/e2e/admin-resources.e2e.ts` asserts the CURRENT
 *   or (inconsistent) round-trip for both operations.
 */

export type SystemVariableType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "array"
  | "secret";

/** Response shape for create/get/list items/update (`ISystemVariable`). */
export interface SystemVariable {
  id: string;
  name: string;
  type: SystemVariableType;
  value: unknown;
  label?: string | null;
  description?: string | null;
  /** ISO-8601 timestamp (serialized `Date`). */
  created_at: string;
  /** ISO-8601 timestamp (serialized `Date`). */
  updated_at: string;
}

/** `POST /admin/system-variables` body (mirrors `CreateSystemVariableDto`). */
export interface CreateSystemVariableInput {
  name: string;
  type: SystemVariableType;
  value: unknown;
  label?: string;
  description?: string;
}

/** `PATCH /admin/system-variables/:id` body (mirrors `UpdateSystemVariableDto`). */
export interface UpdateSystemVariableInput {
  name?: string;
  type?: SystemVariableType;
  value?: unknown;
  label?: string;
  description?: string;
}

export interface ListSystemVariablesParams {
  /** Page size sent as `limit`; see the ignored-downstream gap note above. Default 50. */
  pageSize?: number;
  /** Item offset sent as `offset`; see the ignored-downstream gap note above. Default 0. */
  startOffset?: number;
}

/** Raw envelope returned by `GET /admin/system-variables` (`{ variables, total }`). */
export interface ListSystemVariablesPage {
  variables: SystemVariable[];
  total: number;
}
