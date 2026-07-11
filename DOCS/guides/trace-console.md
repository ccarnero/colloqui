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
3. See the trace: Tempo waterfall (timing/spans) + causal node graph (who-called-who) +
   detail table (taxonomy, compliance, cache status) in one screen.

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
| **Message traces** dashboard (Tempo waterfall + causal node graph + detail table) | `http://localhost:3000/d/message-traces?var-correlation_id=<PASTE_HERE>` |
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

## Known limitation (as of this change)

The **Open in Temporal** data link (`workflow_id`/`run_id` columns and node-graph
details) uses the workflow's internal `executionId`, NOT Temporal's own `workflowId` —
the current bus event published by `execution-completed-publisher.activity.ts` does not
carry Temporal's real workflow/run identifiers. The link may 404 until that publisher is
extended (tracked as a follow-up, not part of this change). See
`.sdd/changes/trace-visualization/apply-progress.md` (T4/T6) for the full analysis.

## Payload column (Message traces detail table)

The `payload` column in the detail table is currently a placeholder (`NULL`) — Open
decision 1 in `.sdd/changes/trace-visualization/tasks.md` (show payload as-is, truncated,
or masked; claim-check reference-vs-resolved) is unresolved. Connector endpoint-call
events already show redacted headers + truncated bodies via the raw envelope inspector on
the **Connector detail** dashboard's "Last 50 calls" table (click a row to expand the
JSON view) — that decision only blocks the generic detail-table column for the remaining
event families.
