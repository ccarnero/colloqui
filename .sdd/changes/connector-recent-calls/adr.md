# ADR — connector-recent-calls

Status: Accepted · Date: 2026-06-28

## Context
The connectors page (`/connections/http`) is a flat list with an edit dialog; there is no
detail page and no per-call audit data. We want a "Recent calls" diagnostics view for a
single HTTP adapter (last 20 invocations: method, URL, status, duration, cache hit/miss).
`connector-runtime` publishes nothing today; cache hit/miss exists only as an OTel counter.

---

## D1 — Source the data via a new NATS event consumed by audit-service (Option A)
**Decision:** Instrument `connector-runtime` to emit one lightweight NATS event per HTTP
call. `audit-service` already runs a per-tenant durable consumer over `INGRESS-<tenant>`
streams filtered by `evt.*.*.platform.>`, so it persists the event with zero new consumer
code. The admin console reads it through the existing `GET /audit/events` gateway proxy.

**Alternatives rejected:**
- **B — Temporal workflow history.** Querying Temporal per adapter is expensive, has no
  adapterId index, exposes internal activity payloads, and needs a new backend query path.
- **C — Reuse existing audit/event data.** No existing event carries adapterId + resolved
  URL + status + cache outcome; nothing to query.

**Consequences:** One additive publish in the activity; reuses the audit persistence and
query path verbatim. New `NATS_URL` env var for `connector-runtime`. Transport-level
failures (thrown, no HTTP status) are not recorded in v1 (D7).

---

## D2 — Subject must put `platform` in the domain slot
**Decision:** Publish to
`evt.<tenant>.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1`.
**Context:** `audit.service.ts` binds `filterSubject = "evt.*.*.platform.>"`. The 3rd
token (domain) MUST be `platform`, or the row is never written. The CloudEvents `type`
stays `connector.endpoint_call.completed.v1` (the exact-match query filter), distinct from
the subject. Built with shared `buildSubject` / `buildEventEnvelope` to stay canonical.
**Consequence:** Coupling to the audit subject convention is explicit and documented; a
wrong domain token fails silently, so this is called out in the design and tasks.

---

## D3 — Detail page, not a drawer (user-confirmed)
**Decision:** A routed page at `/connections/http/:id`, mirroring `ChannelDetailComponent`,
not an overlay/drawer. **Consequence:** Deep-linkable, refresh-safe, reuses the existing
detail-page conventions (PageHeader, sections, signal state). Route registered after the
`http/internal` / `http/external` redirects so they keep matching.

---

## D4 — Reuse the `HttpResponseCacheResult` vocabulary, collapsed for the UI
**Decision:** The activity maps the runtime enum (`hit/miss/bypass/store/store_skip`) to a
UI-facing `"hit" | "miss" | "bypass" | null`: HIT→hit, MISS→miss, BYPASS→bypass,
STORE/STORE_SKIP→ignored (they follow a MISS). The first decisive outcome wins.
**Alternative rejected:** surfacing all five states — `store`/`store_skip` are
post-fetch storage details, noise for a diagnostics list.
**Consequence:** `cachedFetch` gains an optional `onCacheResult` callback; metrics behaviour
is unchanged.

---

## D5 — Filter by adapterId client-side
**Decision:** Query `GET /audit/events?type=…&from=…&limit=200` and filter
`payload.adapterId === id` in the browser, then `slice(0,20)`.
**Context:** The gateway proxy DTO (`audit-proxy-query.dto.ts`) only forwards
`type/from/to/limit/offset`; there is no adapterId filter, and adding one means changing
the gateway DTO, the audit DTO, the repository SQL, and a new index — out of scope for a
diagnostics slice.
**Consequence:** Over-fetch (200 rows) to survive client filtering. Adequate for a 60-min
window; a busy single-tenant could exceed 200 endpoint calls/hour and lose older rows for
a low-traffic adapter. Accepted for v1; a server-side `adapterId` filter is the follow-up
if needed.

---

## D6 — correlationId is NOT plumbed; deep-link only when present
**Decision:** `EndpointCallArgs` carries no correlation/causation, and the activity has no
access to the originating workflow's correlation_id. We do NOT fabricate one. The envelope
gets a fresh `correlation_id` (from `buildEventEnvelope`) which is meaningless as a business
trace, so the UI must NOT link to it. The `IConnectorCall.correlationId` is populated only
if a real correlation later appears on the row; today it is typically absent and the row
renders as non-clickable.
**Alternative rejected:** using the envelope's auto-generated correlation_id as the trace
link — it would deep-link to an empty/incorrect trace.
**Consequence:** Deep-link is best-effort and usually inactive in v1. Plumbing the workflow
correlation through `EndpointCallArgs` is a clean follow-up that makes every row clickable.

---

## D7 — Record only calls that produced an HTTP status
**Decision:** Emit the event on `httpCallWithRetry` return (any HTTP status, including
4xx/5xx). Do NOT emit when it throws (network error / timeout / exhausted retries).
**Consequence:** Transport failures are absent from the Recent-calls list in v1. They are
still visible via metrics/logs. Capturing them needs a status sentinel (e.g. `0`) and a
publish in the catch path — deferred.

---

## D8 — `resolvedUrl` truncated at 120 chars
**Decision:** Truncate to 120 chars (with `…`) at publish time, and again defensively in
the UI; the UI shows the stored value in a `title` tooltip. **Context:** No reliable full
URL is otherwise surfaced (no correlation deep-link in v1). **Consequence:** Very long URLs
lose their tail in storage. 120 chars covers base + path + a short query for the common
case; acceptable for a diagnostics list.

---

## D9 — Telemetry must never break the activity
**Decision:** `publishEndpointCallEvent` is fire-and-forget with a `.catch` that logs a
warning; the NATS connection is a lazy singleton with `waitOnFirstConnect`. A publish or
connection failure must not affect the HTTP call result or the workflow.
**Consequence:** Lost events under NATS outage are acceptable (diagnostics, best-effort).
