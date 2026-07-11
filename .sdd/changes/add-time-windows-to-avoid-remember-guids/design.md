# Design — add-time-windows-to-avoid-remember-guids

## Problem (one line)

Today an operator can only look at a trace they *already have a `correlation_id` for*
(paste into the `$correlation_id` textbox of the **Message traces** dashboard). To *find*
a `correlation_id` they must leave Grafana and run the SQL one-liner from
`DOCS/guides/trace-console.md`, or open the admin-console. There is no "recent traces"
list *inside the operational dashboard itself*. We remove the GUID-memorization step.

## Chosen approach (Option A + textbox escape hatch)

Add ONE new panel — a **"Recent traces"** table — at the **top** of the existing
`message-traces.json` dashboard (uid `message-traces`). One row per `correlation_id`
that has activity inside the dashboard's native time picker window
(`$__timeFilter(occurred_at)`). A per-row data link jumps into the *same* dashboard with
`var-correlation_id` interpolated, preserving the operator's time window. The existing
`$correlation_id` textbox stays untouched as the escape hatch (paste a known id, or an id
from admin-console / SQL). Nothing else on the dashboard changes except three panels shift
down to make room.

Optional cheap companion: a small **"Orphan events (no correlation_id)"** stat on the same
top row, making drift-row invisibility (see below) numerically visible for free.

### Why this is the whole change

- No new datasource, no new variable, no backend code, no schema change *in this slice*.
- The panel reuses the `tracking-postgres` Postgres datasource already used by every SQL
  panel on both dashboards.
- The composite index `(correlation_id, occurred_at)` and a `tracked_events` retention
  policy are the only production hardening this feature *wants* — both are explicitly
  **out of scope** here and captured in "Production prerequisites" below.

## Data flow

```
Operator opens /d/message-traces (time picker = "recent" window, e.g. now-6h)
        │
        ▼
"Recent traces" table panel runs recent-traces CTE against tracking-postgres
   (window = $__timeFilter(occurred_at))
        │
        ▼
One row per correlation_id: start_ts, tenant, entry_kind, event_count,
   duration_ms, terminal_kind, terminal_business_fn
        │  operator clicks a row's correlation_id
        ▼
Data link → /d/message-traces?var-correlation_id=<id>&${__url_time_range}
   (same dashboard, window preserved) → existing panels 1-3 render that trace
```

## The SQL (join-back CTE — binding)

A naive `GROUP BY correlation_id` over only the windowed rows truncates
`start_ts` / `entry_kind` / `event_count` for any trace that *started before* the window
but is still active inside it. So we do the **join-back**: the CTE picks the DISTINCT
`correlation_id`s that have *any* event in the window; the outer query then aggregates
**ALL** rows of those ids (served by `idx_tracked_events_correlation_id`), not just the
windowed slice.

```sql
WITH recent_ids AS (
  SELECT DISTINCT correlation_id
  FROM tracking.tracked_events
  WHERE $__timeFilter(occurred_at)
    AND correlation_id IS NOT NULL
)
SELECT
  t.correlation_id,
  min(t.occurred_at)                                            AS start_ts,
  (array_agg(t.tenant ORDER BY t.occurred_at ASC)
     FILTER (WHERE t.tenant IS NOT NULL))[1]                    AS tenant,
  (array_agg(t.kind ORDER BY t.occurred_at ASC))[1]             AS entry_kind,
  count(*)                                                      AS event_count,
  round(
    extract(epoch FROM (max(t.occurred_at) - min(t.occurred_at))) * 1000
  )::bigint                                                     AS duration_ms,
  (array_agg(t.kind ORDER BY t.occurred_at DESC))[1]            AS terminal_kind,
  (array_agg(t.business_fn ORDER BY t.occurred_at DESC))[1]     AS terminal_business_fn
FROM tracking.tracked_events t
JOIN recent_ids r ON r.correlation_id = t.correlation_id
GROUP BY t.correlation_id
ORDER BY start_ts DESC
LIMIT 50;
```

Notes tied to the binding constraints:

- **Join-back (constraint 1)**: `recent_ids` is windowed; the outer aggregate is over the
  full trace. `idx_tracked_events_correlation_id` serves the join. `min(occurred_at)`,
  the entry-kind `array_agg`, and `count(*)` therefore reflect the *whole* trace, not the
  windowed fragment.
- **Bounded cost (constraint 2)**: `ORDER BY start_ts DESC LIMIT 50` — same precedent as
  connector-detail's "Last 50 calls".
- **Entry/terminal kind (constraint 3)**: `(array_agg(kind ORDER BY occurred_at ASC))[1]`
  / `DESC`. `kind` is **nullable** — for a drift-y trace the earliest/latest event may have
  `kind IS NULL`, so `entry_kind` / `terminal_kind` can be NULL; the panel's field config
  shows an em dash (`—`) via a "No value" mapping. We deliberately do NOT `coalesce(kind,
  subject)` here so the null stays legible as "kind unknown" rather than silently masked.
- **No new textbox interpolation (constraint 8)**: this SQL uses only Grafana macros
  (`$__timeFilter`) — no `'$var'` string interpolation. The pre-existing unquoted
  `'$correlation_id'` interpolation on panels 2/3 is inherited debt; we neither remove nor
  extend it here.
- **occurred_at, not ingested_at (constraint 9)**: "recent" = producer time
  (`occurred_at`, indexed). Replay/backfill can ingest old `occurred_at` rows now
  (`ingested_at = now()`), so a backfilled trace will appear positioned by its *original*
  producer time, not by when it landed. This caveat is documented in the guide.

### $tenant decision (constraint 7)

**Decision: tenant is a display COLUMN only; the dead `$tenant` template variable is NOT
wired into this panel's WHERE.** Rationale (one line): the join-back aggregates whole
traces, so a correct tenant filter would have to run *inside* `recent_ids` with
multi/`includeAll` quoting in raw SQL — that quoting is fiddly and adjacent to the
inherited unquoted-interpolation debt we are explicitly not extending; surfacing tenant as
a sortable/searchable column gives the operator the same triage power at zero interpolation
risk. `$tenant` stays defined (it is harmless and already there) but remains display-time
only for now; wiring it is a clean follow-up once the composite index lands.

### Drift-row visibility decision (constraint 6)

Rows with `correlation_id IS NULL` (rule families 1/12/13/14/15/18 — non-envelope + drift)
are **invisible** to this list by construction (`recent_ids` filters `correlation_id IS NOT
NULL`). This is documented verbatim in the panel `description`. Because the orphan count is
a *trivially cheap* single aggregate served by `idx_tracked_events_occurred_at`, we ALSO
add a small companion **stat** panel on the same top row:

```sql
SELECT count(*) AS orphan_events
FROM tracking.tracked_events
WHERE $__timeFilter(occurred_at)
  AND correlation_id IS NULL;
```

If review prefers a single-panel diff, the stat is droppable — the panel description alone
satisfies the "make drift visible" requirement. Kept because it is one bounded aggregate,
not a scan.

## Panel JSON structure sketch

New table panel (inserted as the FIRST element of `panels[]` in `message-traces.json`):

```jsonc
{
  "title": "Recent traces",
  "description": "One row per correlation_id active in the dashboard time window ($__timeFilter on occurred_at, producer time). Aggregates the WHOLE trace via a join-back CTE, so start/entry/count reflect events that began before the window too. Click a correlation_id to open the trace below (time window preserved). NOTE: rows with a NULL correlation_id (non-envelope + causal-drift events, rules 1/12/13/14/15/18) never appear here by design — see the 'Orphan events' stat for their count. 'recent' = occurred_at (producer time); replayed/backfilled rows sort by original producer time, not ingest time.",
  "type": "table",
  "gridPos": { "h": 8, "w": 20, "x": 0, "y": 0 },
  "datasource": { "type": "postgres", "uid": "tracking-postgres" },
  "targets": [
    { "refId": "A", "format": "table", "rawQuery": true, "rawSql": "<recent-traces CTE above>" }
  ],
  "fieldConfig": {
    "defaults": {},
    "overrides": [
      {
        "matcher": { "id": "byName", "options": "correlation_id" },
        "properties": [
          { "id": "links", "value": [
            {
              "title": "Open trace",
              "url": "/d/message-traces?var-correlation_id=${__data.fields.correlation_id}&${__url_time_range}",
              "targetBlank": false
            }
          ] }
        ]
      },
      {
        "matcher": { "id": "byName", "options": "duration_ms" },
        "properties": [ { "id": "unit", "value": "ms" } ]
      },
      {
        "matcher": { "id": "byName", "options": "entry_kind" },
        "properties": [ { "id": "mappings", "value": [ { "type": "special", "options": { "match": "null", "result": { "text": "—" } } } ] } ]
      },
      {
        "matcher": { "id": "byName", "options": "terminal_kind" },
        "properties": [ { "id": "mappings", "value": [ { "type": "special", "options": { "match": "null", "result": { "text": "—" } } } ] } ]
      }
    ]
  }
}
```

Companion stat panel (second element of `panels[]`):

```jsonc
{
  "title": "Orphan events (no correlation_id)",
  "description": "Count of events in the window with correlation_id IS NULL (non-envelope + causal-drift rows). These are INVISIBLE to the Recent traces list by design; this stat keeps their volume visible. Cheap single aggregate over idx_tracked_events_occurred_at.",
  "type": "stat",
  "gridPos": { "h": 8, "w": 4, "x": 20, "y": 0 },
  "datasource": { "type": "postgres", "uid": "tracking-postgres" },
  "targets": [
    { "refId": "A", "format": "table", "rawQuery": true, "rawSql": "<orphan count above>" }
  ],
  "fieldConfig": {
    "defaults": {
      "unit": "short",
      "thresholds": { "mode": "absolute", "steps": [ { "color": "green", "value": null }, { "color": "yellow", "value": 1 } ] }
    }
  }
}
```

### Data link details (constraint 4/5)

- **Single-`$` panel-level convention**: `${__data.fields.correlation_id}` — NOT the
  double-`$$` `envsubst`-escaped form used by the dashboard-level `links` array
  (`$${temporal_ui_base}`). Data links are rendered by Grafana at view time, not by the
  ConfigMap `envsubst` pass, so a single `$` is correct and matches connector-detail's
  "Last 50 calls" `correlation_id` link idiom already in this same file.
- **Window preservation**: append `&${__url_time_range}` so the click carries the
  operator's current time range into the target (the dashboard-level `links` array uses
  `keepTime:false` and is unaffected).
- **Datasource by uid (constraint 5)**: `{ "type": "postgres", "uid": "tracking-postgres" }`
  — identical to every sibling SQL panel. No hardcoded host, no new datasource block.

## gridPos / layout plan

`message-traces.json` currently stacks three full-width panels at y = 0 / 12 / 24. The new
top row is `h: 8`. Everything shifts down by 8:

| Panel | Type | Before (y) | After (y) |
|---|---|---|---|
| **Recent traces** (new) | table (w20 x0) | — | **0** |
| **Orphan events** (new) | stat (w4 x20) | — | **0** |
| Trace waterfall (Tempo) | traces | 0 | **8** |
| Causal node graph | nodeGraph | 12 | **20** |
| Trace events (detail) | table | 24 | **32** |

Only the `y` value of the three existing panels changes (h/w/x untouched). `connector-detail.json`
is NOT modified.

## Doc changes (`DOCS/guides/trace-console.md`)

Amend the "30 seconds" flow so step 1 leads with the in-dashboard list:

1. **Preferred**: open the **Message traces** dashboard, set the time picker to "recent"
   (default now-6h), read the **Recent traces** table at the top, click the row you want —
   no `correlation_id` to copy, no SQL, no GUID to remember. The escape hatch (paste a
   known id into `$correlation_id`) and the SQL one-liner stay documented as fallbacks.
2. Add a one-line caveat: "recent" is `occurred_at` (producer time); replayed/backfilled
   events sort by their original producer time, and orphan/drift events (no
   `correlation_id`) are counted in the "Orphan events" stat but never listed as traces.

No change to the non-duplication boundary: this is still the *operational* (platform-engineer)
Grafana view. It does NOT reimplement the admin-console causal-chain / verdict view — it
only lists ids and hands off to the existing Tempo/node-graph/detail panels. The admin-console
`/processes/trace` page remains the product/support per-message view. Boundary from
`.sdd/changes/trace-visualization/design.md` holds unchanged.

## Production prerequisites (OUT of scope — flag only, do NOT implement here)

These are real production-hardening items this feature depends on at scale. They are
deliberately excluded from this slice and must be handled before high-volume prod use:

1. **Composite index `(correlation_id, occurred_at)`** on `tracking.tracked_events`. The
   join-back's outer aggregate currently rides `idx_tracked_events_correlation_id` and then
   sorts/aggregates on `occurred_at` per group. At dev/fixture volume this is fine; at prod
   volume a covering `(correlation_id, occurred_at)` index removes the per-group sort. This
   is a `CREATE INDEX CONCURRENTLY` DDL change to `tracked-events.sql` — a separate,
   reviewed change, because `CONCURRENTLY` cannot run inside the existing batched
   `apply-schema.ts` transaction pattern and needs its own operational handling.
2. **`tracked_events` retention policy**. `recent_ids` scans `$__timeFilter(occurred_at)`
   over an unbounded table. Without retention (partition drop / TTL job) the windowed scan
   degrades as the table grows regardless of the "recent" filter. Retention is a separate
   operational change (partitioning strategy or scheduled prune), not a dashboard concern.

Both are named in `adr.md` as prerequisites and intentionally left to follow-up changes so
this slice stays a single, revertable, dashboard-only PR.
