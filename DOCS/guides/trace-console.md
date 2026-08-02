# Trace console — entry points for message tracing

Single entry-point guide for tracing a message through the platform: which URL to open,
what to paste, and where each view is for. Companion to
`.sdd/changes/trace-visualization/design.md` (the complementarity note explaining WHEN
to use the admin-console trace page vs. the Grafana/Tempo dashboards below).

Run `./port-forward.sh` first — it forwards `grafana`, `tempo`, and `temporal-ui`, and
echoes every URL below to your terminal so they are always one scroll away.

## Mini-guide: trace a message in 30 seconds

1. **Preferred — no GUID to remember**: open the **Message traces** dashboard, set the
   time picker to a "recent" window (default `now-6h`), and read the **Recent traces**
   table at the top. It lists one row per `correlation_id` active in that window
   (start time, tenant, entry/terminal kind, event count, duration) — click a row's
   `correlation_id` to jump straight into the trace below, with the time window
   preserved. No copy-paste, no SQL, no admin-console detour needed for the common case.
2. **Fallbacks** (still supported, useful when you already know the id or need a wider
   search):
   - **From the admin-console trace page** (`/processes/trace`) — it lists recent
     traces and shows the `correlation_id` for the message you picked.
   - **From SQL directly** (fastest when you already know roughly when/what):
     ```sql
     SELECT correlation_id, min(occurred_at) AS started, count(*) AS events
     FROM tracking.tracked_events
     WHERE occurred_at > now() - interval '1 hour'
       AND correlation_id IS NOT NULL
     GROUP BY correlation_id
     ORDER BY started DESC
     LIMIT 20;
     ```
     Connect via `POSTGRES_URL` after `kubectl port-forward -n support-services-dev svc/postgres 5432:5432`.
   - Paste a known id into the **Message traces** dashboard's `$correlation_id` textbox
     (URL below — append `?var-correlation_id=<value>` to jump straight there).
3. See the trace: Tempo waterfall (timing/spans) + detail table (taxonomy, compliance,
   cache status) in Grafana. For who-called-who causality, use the admin-console's
   **causal graph view** (`processes/trace/:correlationId`) — see "Two console views"
   below; Grafana's own causal node graph panel was removed (business causality now
   lives in the console, not Grafana).

**Caveats for the Recent traces table:**

- "Recent" means `occurred_at` (producer time, indexed) — NOT `ingested_at`. Replayed or
  backfilled events sort by their *original* producer time, so a replayed trace may not
  appear at the top of the window even if it was just re-ingested.
- Events with `correlation_id IS NULL` (non-envelope + causal-drift rows) never appear as
  rows in this table by design — their count is surfaced instead by the companion
  **Orphan events** stat next to the table, so drift volume stays visible without
  cluttering the trace list.

## Entry points (dev environment)

All URLs below assume `./port-forward.sh` is running with default ports
(`GRAFANA_PORT=3000`, `TEMPO_PORT=3200`, `TEMPORAL_UI_PORT=8233`).

| What | URL |
|---|---|
| Grafana folder **"Message tracking"** (both dashboards, tag-filtered — folder UIDs are server-generated, so this is the stable link) | `http://localhost:3000/dashboards?tag=message-tracking` |
| **Message traces** dashboard (Recent traces + Tempo waterfall + Orphan events + detail table — no causal node graph panel, see below) | `http://localhost:3000/d/message-traces?var-correlation_id=<PASTE_HERE>` |
| **Connector detail** dashboard (invocations, latency, error rate, cache hit-rate, last 50 calls) | `http://localhost:3000/d/connector-detail?var-connector=<CONNECTOR_ID>` |
| **Tempo Explore** (search traces without knowing the id — by service, tag, duration) | `http://localhost:3000/explore?left=%7B%22datasource%22:%22tempo%22%7D` |
| **Temporal UI** (workflow execution history) | `http://localhost:8233` |
| **admin-console trace page** (per-message product/support view — see the non-duplication note below) | `http://<admin-console-host>/processes/trace/:correlationId` |

## Which view do I want?

Per `.sdd/changes/trace-visualization/design.md`'s complementarity note:

- **admin-console `/processes/trace`** — product/support operator debugging ONE
  message: causal chain, pub/sub fan-out, verdict (received / replied / failed), in the
  product's own UI. Use this first for "did this message get delivered?" questions.
- **Grafana "Message traces" / "Connector detail"** — platform engineer doing
  operational analysis: exact span timing, cross-trace latency percentiles, error rates,
  cache hit-rates. Use this for "why is it slow?" / "is this connector healthy?"
  questions.

Both key off the SAME `correlation_id` — copy-paste it between the two, no separate ID
scheme.

## Two console views: waterfall and causal graph

`processes/trace/:correlationId` offers a view switcher between two
console-native views, both fed by the ingester's `GET /chains/:correlationId`
endpoint (`services/tracking-ingester-service/README.md` — response shape,
tenant scoping, `has_envelope`/`orphan_count` semantics) instead of the
legacy client-side assembly against audit endpoints. A third "Legacy" tab
keeps the old client-side assembly available; removing it is a separate,
later human decision.

- **Waterfall view** — events ordered by `occurred_at`, indented by
  `causation_depth`, duration bars sourced from `tracking.tracked_event_spans`
  (matched by `kind_prefix`/`entity_id`), point events rendered as diamonds,
  color-coded by category (channel / platform / agent). Header chips show
  `correlation_id`, total duration, and the bottleneck (longest span + % of
  total).
- **Causal graph view** — nodes are events, edges are `causation_id →
  event_id` (dashed when only `correlation_id` links two events, i.e. the
  causal parent fell outside the fetched chain), with a chain-completeness
  badge and a detail card per selected event (including a flag for
  null-tenant rows). This view replaces Grafana's former "Causal node
  graph" panel as the place to answer who-called-who questions.

**Why the Grafana panel was removed**: Grafana's node-graph panel type could
show edges but not the richer per-event detail (payload access, taxonomy
fields, chain-completeness) the causal-graph console view needed, and
duplicating causality across both a Grafana panel and a console view
invited them to drift. Grafana keeps the panels it is actually good at —
Tempo waterfall (span timing), Recent traces (correlation discovery),
Orphan events (drift volume), Trace events detail (taxonomy/compliance) —
while business causality (who-called-who, with drill-down) now lives
exclusively in the admin console's causal graph view.

## Payload viewer (event detail)

The causal-graph detail card in the admin-console trace page (`/processes/trace`)
has a "View payload" action for the selected event — `manual-loops/payload-capture.md`.

- **Admin-gated**: the action only renders when the session user has the
  `tracking:payload:read` permission (tenant-admin, or a platform-scope
  token). Non-admins never see the button.
- **On-demand fetch**: the payload is never pre-fetched with the causal chain
  — clicking "View payload" issues a dedicated request to
  `GET /api/tracking/chains/:correlationId/events/:eventId/payload` (gateway
  proxy of the ingester's own `/chains/:correlationId/events/:eventId/payload`
  route). Result is rendered JSON, pretty-printed, collapsed by default.
- **Audited**: every successful fetch is picked up by the gateway's global
  audit interceptor and persisted to `gateway_audit_events` — actor
  (`jwt_subject`), tenant, the audited path (which carries the event id), and
  the `correlation_id` stamped onto the request. There is no separate opt-in;
  viewing a payload is always audited.
- **Status-specific messages** (mirroring `tracked_events.payload_status` from
  the tracking-ingester-service README):
  - `scrubbed` (HTTP `410`) → "Payload expired (30-day retention)".
  - `unresolved`/`none` (HTTP `404`) → "Payload was not captured (claim-check
    expired)" for `unresolved`, "Payload was not captured" for `none`.
  - `inline`/`resolved` (HTTP `200`) → the payload renders normally, labeled
    with its `payload_status`.

The **Message traces** dashboard's `payload` column (below) is unrelated —
that is a separate, still-unresolved decision for the Grafana detail table.

## Run view (per-instance execution view)

A Temporal-UI-like, per-instance execution view in the admin console for a
single workflow run — it answers "what did THIS run do, step by step",
complementary to the other two views in this guide:

- **Causal graph** (`/processes/trace`) — cross-service causality: who
  called whom, across services, for a `correlation_id`.
- **Tempo waterfall** (Grafana) — span timing: how long each hop took.
- **Run view** (new) — the run's own step-by-step flow: which actions and
  conditions fired, in order, for one workflow execution.

Backed by `GET /api/tracking/runs/:workflowId/:runId` (gateway wildcard
proxy of the ingester's `GET /runs/:workflowId/:runId` — see
`services/tracking-ingester-service/README.md` for the response shape and
run-scoping semantics).

### Two entries

1. **Workflows → detail → Executions row click** —
   `processes/runs/:workflowId/:runId`. The direct path for someone already
   looking at a workflow's execution history.
2. **A "Run view" tab in `processes/trace/:correlationId`** — appears when
   the causal chain for that correlation contains a workflow run, so an
   operator debugging a message via the causal graph can pivot straight
   into the run's internal step-by-step flow without leaving the trace
   page.

### The view

- **Header chips**: workflow name (from the workflow definition), status,
  duration, step count.
- **Cast strip**: the run's `cast` (connectors/agents/channels/tools it
  touched), with the current instance highlighted.
- **Equally-spaced vertical flow** — a hand-rolled SVG, NOT time-scaled
  (steps are laid out by sequence, not by duration, since the run view's
  job is "what happened, in what order", not timing — that is the Tempo
  waterfall's job).
- **Anchored popup per step** with peek sub-views (connector, agent,
  channel, or definition detail, quoting the existing feature services) and
  "Open in <feature>" deep-links into the owning console section.
- **Plan-vs-executed**: branches the workflow definition allows but this
  run did not take are rendered dashed, distinguishing the plan from what
  actually executed.

Domain layout (merge-run + layout-run) is a pure, exhaustively unit-tested
core — components only bind the resulting model, they do not compute
layout themselves.

### Degraded modes

- **Runs with no step-level events** (`step_detail: false`) — a resolvable
  run whose own scoped events carry no step-level kinds (e.g. a workflow
  definition with zero actions) falls back to an artifact-only spine
  (events/spans without step detail) plus a "step detail unavailable"
  banner, rather than failing outright. Genuinely pre-step-events runs
  (older than `manual-loops/workflow-step-events.md`) never recorded a
  real `workflowId`/`runId` and 404 instead — they never reach this
  degraded view.
- **Payloads** — step popups reuse the payload-capture states described
  above (admin-gated, on-demand fetch, audited); a step with no captured
  payload shows the same status-specific messaging as the causal-graph
  payload viewer.

## Known limitation (as of this change)

The **Open in Temporal** data link (`workflow_id`/`run_id` columns and node-graph
details) uses the workflow's internal `executionId`, NOT Temporal's own `workflowId`,
so it may 404.

Partially closed since this was written: `publishExecutionStartedEvent` — which now
lives in the same `execution-completed-publisher.activity.ts` — DOES carry
`workflowId` (`<tenant>:<name>:<idempotencyKey|nanoid>`) and `runId`. It is
`publishExecutionCompletedEvent` that still does not: its payload is only
`{ executionId, status, workflowName? }`. Whether the link resolves therefore
depends on which event the row came from. See
`.sdd/changes/trace-visualization/apply-progress.md` (T4/T6) for the original
analysis.

## Payload column (Message traces detail table)

The `payload` column in the detail table is currently a placeholder (`NULL`) — Open
decision 1 in `.sdd/changes/trace-visualization/tasks.md` (show payload as-is, truncated,
or masked; claim-check reference-vs-resolved) is unresolved. Connector endpoint-call
events already show redacted headers + truncated bodies via the raw envelope inspector on
the **Connector detail** dashboard's "Last 50 calls" table (click a row to expand the
JSON view) — that decision only blocks the generic detail-table column for the remaining
event families.
