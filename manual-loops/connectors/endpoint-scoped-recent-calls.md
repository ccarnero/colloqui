# SPEC — Endpoint-scoped recent calls: selecting an endpoint filters the Recent calls feed

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/connectors/`.
> Depends on: `manual-loops/connectors/connection-call-inspector.md`
> (shipped 13/13) — this loop extends its T08 HTTP connector detail surface.
> Origin: user decision 2026-07-29 (design session with Claude).
> Engram topic: 'connectors/endpoint-scoped-calls'.

## Goal

On the HTTP connector detail page, clicking an endpoint card selects it and
scopes the "Recent calls" feed to that endpoint only, with a visible filter
chip to clear back to all-adapter calls. Filtering is SERVER-SIDE (an
`endpointId` query param on the ingester's `GET /events`), so a low-traffic
endpoint's calls are found even when they fall outside the adapter's most
recent N events. The docked call inspector behavior is unchanged.

## User decisions (human boundary — do not reinterpret)

1. (2026-07-29) Filtering is server-side via a new optional `endpointId`
   query param on `GET /events`, matching
   `envelope->'data'->'payload'->>'endpointId'`. Client-side filtering of the
   already-fetched adapter feed was explicitly REJECTED: it filters after the
   `limit`, so a low-traffic endpoint would show empty — exactly the case the
   view exists for.
2. (2026-07-29) Interaction: endpoint cards become selectable (click toggles;
   clicking the selected card deselects). Selection scopes the existing
   Recent calls section in place — no navigation, no new route. A filter chip
   ("`GET /path` ×") above the call list clears the selection. This is an
   approved addition on top of the design contract's Connection detail
   section; the card/list visual language of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` still binds.
3. (2026-07-29) `payload_endpoint_id` joins the scalar list projection so the
   console can display/verify the endpoint of each row. Payload bodies remain
   excluded from every list projection — unchanged.
4. Scope is the HTTP connector detail page only. MCP tools, agent executions,
   and hosted-service operations do NOT get per-item filtering in this loop
   (see Out of scope).

## Prior art (validated 2026-07-29 — REUSE, do not duplicate)

The engine does not forward this section — it is the author-facing registry.
Repeat each citation inside the body of the task that uses it.

- **`endpointId` is already emitted on every HTTP connector call event:**
  `services/connector-runtime/src/activities/_shared/event-publisher.ts:81`
  (payload field `endpointId`). NO runtime change is needed in this loop.
  Note: serviceCall and raw-branch reuse of the same event kind carry no
  `endpointId` — the filter simply never matches them, which is correct.
- **Ingester query pipeline (all four files move together):**
  - param validation `services/tracking-ingester-service/src/lib/parse-events-query.ts`
    (shape at :12-26, normalization at :44-58 — blank strings → `null`);
  - SQL builder `build-events-query.ts` (scalar column list
    `EVENTS_COLUMNS` :170-216, WHERE assembly inside `buildEventsQuery`
    :233-260, `EventRow` type :102-169);
  - row normalization `normalize-events-row.ts` (payload scalar coercion,
    e.g. `payload_http_status`/`payload_duration_ms` :23-28);
  - response shaping `to-events-response.ts`;
  - orchestration `handle-events-request.ts:62-80` (destructures parsed
    params and logs them — the new param joins both).
- **Gateway needs NO change:** `services/api-gateway/src/modules/tracking/tracking.controller.ts:100-118`
  forwards `GET /events` query params verbatim (`@Query()` pass-through, the
  ingester validates). Cite this in the task; do not add a DTO.
- **Console feed:** `services/admin-console/src/app/core/services/connector-call.service.ts`
  — `recentCalls` :170-188 (sets `resource=adapter/<id>`), row interface
  `ITrackingEventRow` :87-156, `toCall` :281-296 (today hard-codes
  `endpointId: null` with a comment at :284-287 that this loop makes stale —
  delete the comment when wiring the real value).
- **Console UI:** `features/data-integrations/connectors/detail/connector-detail.component.ts`
  — endpoint cards :155-172 (static, no selection), Recent calls section
  :190-240 (call rows open the docked inspector via `openInspector`).
- **E2E baseline:** `scripts/e2e/http-workflow.sh` Stage 14 :1297-1330 already
  polls `GET /api/tracking/events?type=connector.endpoint_call.completed.v1&resource=adapter/<id>`
  — the endpoint-filtered assertion extends this stage's pattern.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- List endpoints keep EXCLUDING payload bodies: `payload_endpoint_id` is a
  scalar; the raw `envelope` jsonb stays out of every list projection.
- No new endpoints and no gateway DTOs — the ONLY API surface change is the
  optional `endpointId` query param on the existing `GET /events`.
- `endpointId` filters on `envelope->'data'->'payload'->>'endpointId'`
  verbatim; it composes with (does not replace) the existing `type`,
  `resource`, `from`, `limit` params. An event without the field simply never
  matches — no COALESCE fallbacks, no schema/column changes.
- Touched services only: tracking-ingester-service, admin-console.
  connector-runtime, api-gateway, and agent-* services are READ-ONLY in this
  loop.
- Binding styles: ingester = pure functions in `src/lib/*`, one per file, I/O
  only in `main.ts`, plain Bun; console = standalone components, signals,
  OnPush.
- UI follows decision 2 exactly; any further visual deviation from the design
  contract requires human sign-off before the task commits.
- Console UI strings in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — tracking-ingester-service tests + typecheck
cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit
# G2 — admin-console tests (from T02 onward)
cd services/admin-console && pnpm test
# G3a — ITERATION (per attempt, source-mounted dev mode; admin-console tasks skip G3a)
./dev-mode.sh deps && ./dev-mode.sh <touched-svc> on && ./scripts/e2e/http-workflow.sh
# G3b — COMMIT GATE (once per task, built image)
./dev-mode.sh <touched-svc> off && ./rebuild-redeploy.sh <touched-svc> dev && ./scripts/e2e/http-workflow.sh
```

Gate rules (self-contained — the engine runs THIS file verbatim):

- ALL existing unit AND integration tests must pass in every touched service,
  every task. Weakening, skipping, or deleting an existing test is an
  automatic reviewer rejection.
- G3b runs for every task; a diff touching `packages/shared` redeploys every
  dependent service. The cluster must never drift from the branch.
- Commits only happen with dev-mode OFF and the built image live.
- G3a/G3b failures count as failed attempts like any other gate.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` must be green once
before T01; if it fails, skip G3a and rely solely on G3b.

E2E CLEANUP: every e2e script tears down what it creates — trap-guarded,
account-scoped, idempotent teardown (conventions from
`connector-trace-linking.md` T08 stand).

---

## Task queue

### T01 — Ingester: `payload_endpoint_id` scalar + `endpointId` filter

- `services/tracking-ingester-service/src/lib/parse-events-query.ts`
  (raw/parsed shapes :12-26, normalization :44-58): add optional
  `endpointId` to `RawEventsQueryInput` and the parsed result — same
  blank-string-normalizes-to-`null` rule as `resource`/`from`, no format
  validation (it is an opaque id, same division of responsibility as
  `resource`).
- `build-events-query.ts`: add
  `"envelope->'data'->'payload'->>'endpointId' AS payload_endpoint_id"` to
  `EVENTS_COLUMNS` (:170-216) with a doc comment naming the emitting site
  (`event-publisher.ts:81`); add `payload_endpoint_id: string | null` to
  `EventRow`; in the WHERE assembly inside `buildEventsQuery` (:233-260) append
  `envelope->'data'->'payload'->>'endpointId' = $n` when `endpointId` is
  non-null. It COMPOSES with `type`/`resource`/`from` — never replaces them.
- `normalize-events-row.ts` and `to-events-response.ts`: carry the new scalar
  through, following how `payload_method` flows today.
- `handle-events-request.ts` (:62-80): destructure and pass `endpointId`,
  include it in both verbose log lines
  (`endpointId=${endpointId ?? "-"}`).
- Unit tests: param parsed (present/blank/absent), SQL contains the filter
  only when set, filter composes with `resource`, projected scalar present in
  the response row, existing snapshots extended — never weakened.

**Accept**
```
cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit
grep -n "payload_endpoint_id" services/tracking-ingester-service/src/lib/build-events-query.ts
```

### T02 — Console feed: `recentCalls` takes an optional endpoint scope

- `services/admin-console/src/app/core/services/connector-call.service.ts`:
  - `recentCalls` (:170-188) gains an optional `endpointId` argument (or
    options object — follow the file's existing style); when set, append the
    `endpointId` query param alongside `resource`.
  - `ITrackingEventRow` (:87-156) gains `readonly payload_endpoint_id?: string | null;`.
  - `toCall` (:281-296) maps `endpointId: row.payload_endpoint_id ?? null`
    and DELETES the now-stale "never available from this endpoint" comment
    (:284-287).
- No gateway change: `tracking.controller.ts:100-118` forwards query params
  verbatim — cite this in the task log, do not add a DTO.
- Unit tests: param present/absent on the HTTP request, `endpointId` mapped
  from the row, null-safe when the scalar is missing.

**Accept**
```
cd services/admin-console && pnpm test
```

### T03 — Connector detail: selectable endpoint cards + filter chip

- `features/data-integrations/connectors/detail/connector-detail.component.ts`:
  - Endpoint cards (:155-172): clickable + keyboard-accessible
    (`role="button"`, `tabindex`, enter — same pattern as the call rows
    :199-212). Click toggles a `selectedEndpointId` signal; clicking the
    selected card deselects. Selected card gets a visible highlight
    consistent with `call-row--selected`.
  - Recent calls section (:190-240): when `selectedEndpointId()` is set, the
    feed re-fetches via T02's scoped `recentCalls` and a filter chip renders
    above the list — "`{{ method }} {{ path }}` ×" — whose × clears the
    selection and restores the all-adapter feed. Empty state while filtered
    says "No calls for this endpoint in the last 7 days." (English, per
    constraints).
  - Inspector behavior unchanged: rows still call `openInspector`; the open
    inspector CLOSES when the filter changes (its call may leave the list).
  - Loading state while re-fetching reuses the existing spinner block.
- Decision 2 is the binding interaction spec; cite it in the task log.
- Component tests: card click scopes the feed (service called with the
  endpoint id), chip renders with method+path, × clears back to the unscoped
  feed, selected-card class toggles, filtered empty state, inspector closes
  on filter change.

**Accept**
```
cd services/admin-console && pnpm test
```

### T04 — Cluster e2e: endpoint-filtered events round-trip

> AMENDED 2026-07-29 (attempt-1 finding): the original task assumed the
> script's existing `probeEndpoint` action produced events with a non-null
> `endpointId`. It does not — it passes only `adapterId`+`url`, hitting the
> adapter-base branch which publishes `endpointId: null`
> (`execute-with-adapter-base.ts:126`); live data confirms every
> `adapter/<id>` row has a NULL endpointId. The stage therefore needs one
> additive provisioning step to make the assertion reachable.

- `scripts/e2e/http-workflow.sh`:
  1. After login, resolve a real endpoint id at runtime (never hardcode —
     `scripts/e2e/README.md:62-82` documents the staleness class):
     `GET /api/connectors/${ENDPOINT_ADAPTER_ID}` via the existing `api()`
     transport (gateway route `connectors.controller.ts:71`), jq-select the
     endpoint's id.
  2. Add ONE new action `probeEndpointScoped` (`endpointCall` with
     `adapterId` + the resolved `endpointId`) to the manifest workflow —
     `probeEndpoint` and every existing stage/assertion stay untouched. This
     branch (`execute-with-adapter-endpoint`) publishes
     `resource: adapter/<id>` with the payload `endpointId` set.
  3. Add the new stage after Stage 14 (:1297-1330) polling
     `GET /api/tracking/events?type=connector.endpoint_call.completed.v1&resource=adapter/<id>&endpointId=<epId>&limit=20`,
     asserting: at least one row returns, every returned row's
     `payload_endpoint_id` equals the requested id, and a nonexistent
     `endpointId` returns 200 with an empty `events` array (filtered list,
     not a lookup — matches `handle-events-request.ts` semantics).
- Follow the stage's existing polling/timeout/log conventions verbatim;
  update the stage index comment block the same way previous stages did.
- Teardown: the manifest-scoped teardown already covers manifest resources;
  do not add new teardown paths.

**Accept**
```
./scripts/e2e/http-workflow.sh
grep -n "endpointId=" scripts/e2e/http-workflow.sh
```

## Progress

- [x] T01 ingester scalar + filter param
- [x] T02 console feed endpoint scope
- [x] T03 selectable cards + filter chip
- [x] T04 e2e endpoint-filtered round-trip

## Out of scope (explicit)

- Per-item filtering on the other connection screens: MCP tool name, agent
  execution state, hosted-service operation. Same pattern would apply
  (`payload_tool_name` is even already projected) — future queue, on demand.
- Per-endpoint aggregates (call count, error rate, p95 on the endpoint card).
- Persisting the selected endpoint in the URL (query-param deep link) —
  selection is ephemeral UI state in this loop.
- Any change to payload viewing, guards, audit, or retention — the inspector
  and its `tracking:payload:read` guard are untouched.
- Backfilling: events emitted before payload capture shipped carry
  `endpointId` already (it predates this loop), so no history gap is
  expected; if one appears, the UI shows the honest empty state.

## Human boundaries for this change

- Human approves this SPEC before the first run (including decision 1's
  server-side filter and decision 2's interaction spec).
- Visual deviations beyond decision 2 require human sign-off before the task
  commits.
- Human runs the first `--apply` of any destructive/administrative script
  (none expected — T04 only reads).
