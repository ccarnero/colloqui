# Tasks — connector-recent-calls

Ordered, independently verifiable. Backend (T1–T3) and frontend (T4–T7) can proceed in
parallel after T1; T8 is the end-to-end check. Test runner: `bun test` (services),
`bunx ng test` / project's Angular test command (admin-console). Follow strict TDD where
a unit is testable.

---

## T1 — Add `cacheResult` to `IHttpCallResult`
**Files:**
- `services/connector-runtime/src/activities/_shared/http-call-with-retry.ts`
- `services/connector-runtime/src/activities/_shared/http-cache/to-cache-result.ts` (new)

**Do:** Add `EndpointCacheResult = "hit" | "miss" | "bypass" | null` and the optional
`cacheResult` field to `IHttpCallResult`. Add `toEndpointCacheResult(...)` mapping the
runtime enum (HIT→hit, MISS→miss, BYPASS→bypass, else null). Capture the first decisive
outcome in `httpCallWithRetry` via the new `onCacheResult` callback and include it in the
returned object.

**Acceptance:**
- `bun test` in connector-runtime green.
- New unit test: `toEndpointCacheResult` maps all five enum values correctly.
- `httpCallWithRetry` returns `cacheResult: "hit"` for a cached response, `"miss"` for a
  fresh one, and `null`/`"bypass"` with no cache policy. Type-check passes for
  `service-call.activity.ts` (additive field, no break).

---

## T2 — Thread cache outcome out of `cachedFetch`
**File:** `services/connector-runtime/src/activities/_shared/http-cache/cached-fetch.ts`

**Do:** Add optional `onCacheResult?: (r: HttpResponseCacheResultValue) => void` to
`ICachedFetchContext`; call it alongside the existing `recordHttpResponseCache` for the
decisive HIT / MISS / BYPASS outcomes only (not STORE / STORE_SKIP). Metrics calls
unchanged.

**Acceptance:**
- `bun test` green; existing cached-fetch tests unaffected.
- New/updated test: a HIT path invokes `onCacheResult(HIT)` exactly once; a MISS path
  invokes `onCacheResult(MISS)` once and does NOT invoke it for the later STORE.

---

## T3 — Emit `connector.endpoint_call.completed.v1` from the activity
**Files:**
- `services/connector-runtime/src/config.ts` (add `natsUrl`)
- `services/connector-runtime/src/activities/_shared/event-publisher.ts` (new)
- `services/connector-runtime/src/activities/endpoint-call.activity.ts`

**Do:** Add `natsUrl` config (`NATS_URL`, default `nats://localhost:4222`). Implement
`event-publisher.ts` exactly per design A.4 (lazy NATS+JetStream singleton, canonical
subject via `buildSubject`, envelope via `buildEventEnvelope`, `TENANT_HEADER`, URL
truncated at 120, fire-and-forget `.catch` log). Call `publishEndpointCallEvent` in
`executeWithAdapterEndpoint` (endpointId set) and `executeWithAdapterBase` (endpointId
null); time the call with `Date.now()`. Do NOT emit from `executeRaw` (no adapter).

**Acceptance:**
- `bun test` green.
- Unit test (mocked JetStream): publishing produces subject
  `evt.<tenant>.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1`,
  envelope `type === "connector.endpoint_call.completed.v1"`, `data.payload` carries
  `{ adapterId, endpointId, method, resolvedUrl, status, durationMs, cacheResult }`, and
  the `x-yoizen-tenant` header is set.
- A publish rejection is swallowed (activity still returns its result).
- Raw branch emits nothing.

---

## T4 — `IConnectorCall` model + `ConnectorCallService`
**File:** `services/admin-console/src/app/core/services/connector-call.service.ts` (new)
(+ `.spec.ts`)

**Do:** Implement per design B: `recentCalls(adapterId, windowMin=60, limit=20)` →
`GET /audit/events?type=connector.endpoint_call.completed.v1&from=…&limit=200`, map rows
from `payload`, filter `adapterId`, slice to `limit`. Tolerate snake/camel timestamp +
correlation keys.

**Acceptance:**
- `bunx ng test` (or project command) green for the new spec.
- Spec with `HttpTestingController`: request URL/params correct; given mixed-adapter
  events, only the matching adapterId rows return, newest-first, capped at `limit`; rows
  without `payload.adapterId` are dropped.

---

## T5 — Connector detail route + `ConnectorDetailComponent` (info + cache sections)
**Files:**
- `services/admin-console/src/app/features/data-integrations/connectors/detail/connector-detail.component.ts` (new)
- `services/admin-console/src/app/app.routes.ts` (add `http/:id` after the
  `http/internal` / `http/external` redirects)

**Do:** Implement the component skeleton per design C: load `IAdapterDto` via
`HttpAdapterService.get(id)`; render **Connector info** (name, baseUrl, authType, endpoint
count) and **Cache configuration** (only when `hasCacheConfig()`), with a back breadcrumb
to `/connections/http`. No Recent-calls block yet.

**Acceptance:**
- Navigating to `/connections/http/<id>` renders name/baseUrl/authType/endpoint count.
- Cache section hidden when neither `defaultCache.enabled` nor any endpoint cache is
  enabled; shown (TTL + key params) otherwise.
- Component spec: `hasCacheConfig()` true/false cases; load error sets `errorMessage`.

---

## T6 — Add "Recent calls" section to `ConnectorDetailComponent`
**File:** `services/admin-console/src/app/features/data-integrations/connectors/detail/connector-detail.component.ts`

**Do:** Add `canViewCalls()` (`diagnostics:read`), `recentCalls`/`callsLoading` signals,
`loadCalls(id)` after adapter load, and the template block per design E (spinner /
empty-state / `@for`, status badge, duration, truncated URL with tooltip, cache badge only
when `hasCacheConfig() && c.cacheResult`, deep-link to `/processes/trace/:correlationId`
only when `correlationId` present). Import `NgTemplateOutlet` + `RouterLink`.

**Acceptance:**
- With `diagnostics:read`: section renders; mocked service rows show status badge,
  `<n>ms`, truncated URL; cache badge appears only for cache-configured connectors.
- Without `diagnostics:read`: section absent and `ConnectorCallService.recentCalls` not
  called.
- Empty result shows the empty-state copy.
- Rows with a `correlationId` are anchors to `/processes/trace/:id`; rows without are not.

---

## T7 — Wire list page → detail navigation
**File:** `services/admin-console/src/app/features/data-integrations/connectors/connectors.component.ts`

**Do:** Inject `Router`; add a **View** (`visibility`) icon button in the `actions` column
before Edit; `view(id)` → `router.navigate(["/connections/http", id])`. Leave Edit/Delete
untouched.

**Acceptance:**
- View button present per row; clicking navigates to `/connections/http/<id>`.
- Existing edit/delete behaviour unchanged; `bunx ng test` green for connectors spec.

---

## T8 — Manual E2E verification
**Do (local stack: NATS, Temporal, audit-service, gateway, admin-console):**
1. Trigger a workflow `endpointCall` against an adapter+endpoint (one with cache enabled,
   one without).
2. Confirm a row lands in the tenant `events` table with
   `type='connector.endpoint_call.completed.v1'` and the expected `payload`.
3. Open `/connections/http/<adapterId>` as a user WITH `diagnostics:read`: info + cache
   sections correct; Recent calls lists the invocation(s) with method/status/duration/URL;
   cache badge (hit/miss) shows for the cache-enabled connector and is hidden for the other.
4. Open as a user WITHOUT `diagnostics:read`: Recent calls section absent.
5. Repeat a cached call → second row shows `cacheResult = hit`.

**Acceptance:** All five steps observed. No errors in connector-runtime logs from the
publisher; the HTTP call result is unaffected by NATS being momentarily down (kill NATS,
confirm the call still succeeds and only a warning is logged).
