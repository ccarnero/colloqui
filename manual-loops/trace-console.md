# SPEC — Trace console: causal waterfall + graph views (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests and
> dual review. Queues live in `manual-loops/`.
> Origin: user decision 2026-07-11 (Cowork session). Engram topic: `tracking/trace-console`.
> Visual reference: user mockups `consola_trazas_vista_waterfall_temporal.html` and
> `consola_trazas_vista_grafo_causal.html` (see task T05/T06 descriptions).

## Goal

Per-correlation trace views in the admin console, fed by `tracking.tracked_events`
(the durable causal store), replacing the client-side assembly the existing
`processes/trace` feature does against audit endpoints:

1. **Waterfall view** — events ordered by `occurred_at`, indented by `causation_depth`,
   duration bars from `tracking.tracked_event_spans` (`duration_ms`), point events as
   diamonds, color by category (channel / platform / agent).
2. **Causal graph view** — nodes = events, edges = `causation_id → event_id`,
   dashed edge when only correlation links them (no causation), chain-completeness
   badge, detail card per selected event.
3. Grafana keeps ops panels; the confusing "Causal node graph" panel is REMOVED
   (Tempo waterfall panel STAYS).

## User decisions (human boundary — do not reinterpret)

1. Read endpoint lives in `tracking-ingester-service` (owner of the table). No new service.
2. Console UI strings in English (console convention).
3. Grafana: remove ONLY the "Causal node graph" panel; "Trace waterfall (Tempo)",
   "Recent traces", "Orphan events", "Trace events (detail)" panels stay.
4. Views are tenant-scoped through the api-gateway guards; rows with `tenant IS NULL`
   (drift/non-envelope) belonging to the correlation are included but flagged.

## Constraints (apply to every task)

- tracking-ingester-service style is BINDING: pure functions in `src/lib/*` (one per
  file), ALL I/O only in `src/main.ts`, plain Bun (`Bun.serve`) — NO NestJS here.
  Column semantics are bound to `src/lib/to-tracked-event-row.ts`.
- admin-console style is BINDING: standalone components, signals, OnPush, lazy
  `loadComponent` routes, hand-rolled inline SVG (sparkline precedent:
  `shared/components/sparkline/sparkline.component.ts`) — NO chart library.
- api-gateway: new routes are explicit proxy modules (read-only precedent:
  `src/modules/audit/`); guards (TenantGuard + AuthGuard) apply globally — do not
  bypass them, no `@Public()`.
- Schemas/SQL live with the ingester (`src/sql/*.sql`), idempotent
  (`CREATE ... IF NOT EXISTS`), applied by `applySchema` at startup.
- Verbose logging on every query path. Tests in the same task as the behavior.
  Never weaken existing tests. TAXONOMY.md is read-only for this change.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
G1  cd services/tracking-ingester-service && bun test    # includes golden gate >=90%
G2  cd services/tracking-ingester-service && bunx tsc -p tsconfig.json --noEmit
G3  cd services/api-gateway && bun test                  # from T03 onward
G4  cd services/admin-console && pnpm test               # from T04 onward
G5a ITERATION (per attempt, source-mounted) — touched backend services in dev mode:
      ./dev-mode.sh deps            # at task start (sha-compare, cheap)
      ./dev-mode.sh <service> on    # once, at task start
      ./scripts/e2e-http-workflow.sh    # per attempt, exit 0 required
    EXCEPTION: admin-console has no dev-mode — console tasks skip G5a.
    If an attempt changes pnpm-lock.yaml: re-run deps + cycle off/on first.
G5b COMMIT GATE (once per task, built image) —
      ./dev-mode.sh <service> off
      ./rebuild-redeploy.sh <service> dev   # each service touched by the diff
      ./scripts/e2e-http-workflow.sh
    Exit 0 required. Commits only happen with dev-mode OFF, built image live.
```

Gate rules: identical to `manual-loops/workflow-toggle.md` (PRECONDITION
`./scripts/validate-dev-mode.sh --with-e2e` green before task 1 — already satisfied
2026-07-11; all existing unit+integration tests pass in every touched service;
G5b for every task; failures consume attempts).

---

## Task queue

### T01 — Chain read functions in the ingester

New pure functions in `services/tracking-ingester-service/src/lib/`:

- `build-chain-query.ts`: parametrized SQL for events of a correlation —
  `SELECT <explicit columns> FROM tracking.tracked_events WHERE correlation_id = $1
  AND (tenant = $2 OR tenant IS NULL) ORDER BY occurred_at` (never `SELECT *`;
  exclude the raw `envelope` jsonb from the list payload, include a boolean
  `has_envelope`).
- `build-spans-query.ts`: same scoping over `tracking.tracked_event_spans`
  returning `kind_prefix, entity_id, started_at, completed_at, duration_ms`.
- `to-chain-response.ts`: shape `{ correlation_id, tenant, events[], spans[],
  summary: { count, first_at, last_at, total_ms, orphan_count } }` where
  `orphan_count` = events whose `causation_id` is non-null and not present as an
  `event_id` in the set.

Unit tests for the three (query text/params, response shaping, orphan counting,
null-tenant flagging).

**Accept**
```
cd services/tracking-ingester-service && bun test test/unit
```

### T02 — HTTP endpoint in the ingester + k8s Service

- Extend the `Bun.serve` fetch router in `main.ts` (keeping I/O-only-in-main):
  `GET /chains/:correlationId` — tenant read from the `x-yoizen-tenant` header
  (set by the gateway proxy), 400 if missing, 404 if zero events. Uses T01
  functions against the existing pool. `GET /health` untouched.
- Ensure a ClusterIP `Service` exposing port 3000 for the `tracking-ingester-worker`
  Deployment exists in `knative/services/base/` (kustomization-registered) so the
  gateway can reach it (there is none today — the worker was consume-only).
- Integration-style test with a stubbed pool: route match, tenant guard, 404 path.

**Accept**
```
cd services/tracking-ingester-service && bun test
grep -rn "chains" services/tracking-ingester-service/src/main.ts
```

### T03 — Gateway read-only proxy

`services/api-gateway/src/modules/tracking/` mirroring the `audit` module:
`TrackingProxyService extends TenantJsonProxyBase`, `@Controller("tracking")` with
`GET tracking/chains/:correlationId`, config entry
`services.tracking = process.env.TRACKING_SERVICE_URL ?? platformServiceUrl(...)`
pointing at the T02 Service, module registered in `app.module.ts`. Controller
unit tests (proxy called with tenant, path, params).

**Accept**
```
cd services/api-gateway && bun test
```

### T04 — Console data service

`core/services/tracking-chain.service.ts` in admin-console: typed
`getChain(correlationId)` against `${environment.apiUrl}/tracking/chains/:id`,
response types mirroring T01's shape (English names). Unit test (vitest).
Do NOT delete the old `message-trace.service.ts` yet (T07 decides the wiring).

**Accept**
```
cd services/admin-console && pnpm test
```

### T05 — Waterfall view component

`features/processes/trace/waterfall/trace-waterfall.component.ts` (standalone,
OnPush, inline template) implementing the user's waterfall mockup:

- Header chips: correlation_id, total duration, bottleneck (longest span + % of total).
- Grid rows: event name + service (from `subject`/`producer`), indent by
  `causation_depth`, time axis 0→total_ms; span rows as bars (duration from spans,
  matched by `kind_prefix`/`entity_id`), point events as 45°-rotated squares.
- Color by `business_fn` group: channel (`ingress`,`channel-*`) / platform
  (`workflow-*`,`connector-*`,`routing`) / agent (`agent-*`) — one mapping function,
  tested. Legend row. English labels.
- Component tests: bar geometry from a fixture chain, point-event rendering,
  bottleneck computation.

**Accept**
```
cd services/admin-console && pnpm test
```

### T06 — Causal graph view component

`features/processes/trace/causal-graph/causal-graph.component.ts` implementing the
user's graph mockup with hand-rolled SVG (sparkline pattern — geometry in
`computed()`, `[attr.*]` bindings):

- Nodes = events (rounded rects, two text lines: kind + `producer · t+<ms>`),
  laid out by `causation_depth` (vertical spine) with agent-branch offset to a
  second column when depth branches (parent has >1 child).
- Edges: solid `causation_id → event_id`; DASHED when the parent event is missing
  from the set but correlation matches (the "solo correlation" case). Arrowheads.
- Header chips: correlation_id, channel (`tech` of first ingress event), event
  count, duration, chain-completeness badge (`spans closed n/m` from T01 summary).
- Click node → detail card: `event_id`, `causation_id`, `tech`, `business_fn`,
  `causation_depth`, `is_claim_check`, `compliance` (flag null-tenant rows).
- Component tests: edge derivation (solid/dashed/orphan), layout determinism,
  detail card content.

**Accept**
```
cd services/admin-console && pnpm test
```

### T07 — Wire views into the trace feature

- `processes/trace/:correlationId` gets a view switcher (Waterfall | Causal graph),
  both fed by `tracking-chain.service` (T04). The legacy client-side assembly
  (`assemble-trace.ts` path) stays available behind a third tab "Legacy" — removal
  is a HUMAN decision for a later change, not this one.
- Nav: no new section (feature already lives under Processes; update page title if
  needed). Routes stay lazy.
- Component test: switcher renders both new views with the fixture chain.

**Accept**
```
cd services/admin-console && pnpm test
```

### T08 — Grafana: remove the causal node graph panel

In `infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml`:
remove the panel object `"title": "Causal node graph"` (`type: nodeGraph`) from
`message-traces.json`; keep "Trace waterfall (Tempo)", "Recent traces",
"Orphan events", "Trace events (detail)". Re-flow `gridPos` of remaining panels if
needed. JSON must stay valid (validate with `jq` on the extracted key).

**Accept**
```
kubectl kustomize infrastructure/base/observability/grafana >/dev/null && echo kustomize-ok
python3 -c "import sys,yaml,json; d=yaml.safe_load(open('infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml')); j=json.loads(d['data']['message-traces.json']); titles=[p.get('title') for p in j['panels']]; assert 'Causal node graph' not in titles and 'Trace waterfall (Tempo)' in titles, titles; print('panels-ok', titles)"
```

### T09 — Cluster e2e: chain endpoint over a real run

> RETRY NOTE (2026-07-11, after 4-attempt block — see BLOCKED.md): the happy-path
> workflow alone can NEVER satisfy the span assertion (workflow-service emits no
> `execution_started`). Reuse attempt-3/4's approach — idempotent e2e agent +
> agent workflow — but create the agent with `model_config.provider = "ln"`
> (the dev echo provider; `"mock"` does not exist → execution_failed). The
> `POST /api/admin/agents/:id/publish` call needs an explicit `'{}'` body.

Extend `scripts/e2e-http-workflow.sh` (stage-per-function, exit-code contract):
after the existing happy path, take the run's correlation_id and, via the gateway
(same auth/tenant as stage 1): `GET /tracking/chains/<correlation_id>` — assert
HTTP 200, `events.length >= 5`, `summary.orphan_count` reported, and at least one
span with `duration_ms > 0`.

**Accept**
```
./rebuild-redeploy.sh tracking-ingester-service dev
./rebuild-redeploy.sh api-gateway dev
./scripts/e2e-http-workflow.sh
```

### T10 — Docs + index

- `services/tracking-ingester-service/README.md`: document the read endpoint,
  response shape, tenant semantics (null-tenant inclusion), and that the console
  is its consumer.
- `DOCS/guides/trace-console.md`: update to describe the two new views + Grafana
  panel removal rationale (Grafana keeps ops; business causality lives in console).
- `cowork/INDEX.md`: entry for this change. Decision cuádruple with engram topic
  `tracking/trace-console`.

**Accept**
```
grep -n "chains/:correlationId\|chains/" services/tracking-ingester-service/README.md
grep -n "trace-console" cowork/INDEX.md
```

---

## Progress

- [x] T01 chain read functions
- [x] T02 http endpoint + k8s service
- [x] T03 gateway proxy
- [x] T04 console data service
- [x] T05 waterfall view
- [x] T06 causal graph view
- [x] T07 wiring + view switcher
- [x] T08 grafana panel removal
- [x] T09 cluster e2e chain assertion
- [x] T10 docs + index

## Out of scope (explicit)

- Deleting the legacy client-side trace assembly (human decision, later change).
- Search/list UI over correlations (the Grafana "Recent traces" table still covers it).
- New auth schemes; gateway guards as-is.
- Touching TAXONOMY.md, the classifier, or the golden set.

## Human boundaries for this change

- Approving this SPEC before the first `/manual-loop` run.
- Any change to tenant semantics of the read endpoint.
- Removing the legacy trace tab (explicitly deferred).
