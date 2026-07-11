# Tasks: Recent-traces entry point on the Message traces dashboard

Tasks are ordered by dependency. Each is independently verifiable before the next begins.

**Context**: `infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml`
already ships both message-tracking dashboards as inline JSON blocks. This change adds ONE
"Recent traces" table panel (plus a small companion orphan-events stat) to the TOP of the
`message-traces.json` block, with a per-row data link back into the same dashboard, and
amends `DOCS/guides/trace-console.md`. No backend, no schema, no `connector-detail.json`
changes. See `design.md` (SQL + layout) and `adr.md` (options + $tenant + drift decisions).

**Datasource / fixture for live checks**: `tracking-postgres` (uid); an 11-event telegram
chain is already ingested in dev under `correlation_id = 8c2479be-95c1-460f-bbd7-a9b79312952c`
(see `.sdd/changes/trace-visualization/tasks.md` T5).

**Out of scope (prod prerequisites — do NOT implement here)**: composite index
`(correlation_id, occurred_at)`, `tracked_events` retention policy. Flagged in `adr.md`.

---

## T1 — Add the "Recent traces" table panel (join-back CTE) to message-traces.json ✅ DONE

Panel inserted as `panels[0]`; jq acceptance check passed (title/type/gridPos/datasource/rawSql/link all match).

Insert the panel as the FIRST element of the `panels[]` array in the `message-traces.json`
block. Use the exact recent-traces CTE from `design.md`: windowed `recent_ids` CTE
(`$__timeFilter(occurred_at)` + `correlation_id IS NOT NULL`), outer aggregate over ALL rows
of those ids, `ORDER BY start_ts DESC LIMIT 50`. Entry/terminal kind via
`(array_agg(kind ORDER BY occurred_at ASC/DESC))[1]`; tenant as a column only.

Field config:
- `correlation_id` → data link `"/d/message-traces?var-correlation_id=${__data.fields.correlation_id}&${__url_time_range}"`, `targetBlank:false` (single-`$` panel convention, window preserved).
- `duration_ms` → unit `ms`.
- `entry_kind` / `terminal_kind` → null value mapping to `—`.
- Panel `description` documents: whole-trace join-back semantics, occurred_at = producer time (replay caveat), and that NULL-correlation_id drift rows are invisible by design.
- `gridPos`: `{ "h": 8, "w": 20, "x": 0, "y": 0 }`.
- `datasource`: `{ "type": "postgres", "uid": "tracking-postgres" }`.

**Files to modify:**
- `infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml` (the `message-traces.json` block only).

**Acceptance check:**
```bash
cd /Users/chris/sources/yoizen/platform-cluster
yq '.data."message-traces.json"' infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml | jq -e \
  '.panels[0].title=="Recent traces"
   and .panels[0].type=="table"
   and .panels[0].gridPos.y==0
   and .panels[0].datasource.uid=="tracking-postgres"
   and (.panels[0].targets[0].rawSql | test("recent_ids"))
   and (.panels[0].targets[0].rawSql | test("LIMIT 50"))
   and (.panels[0].fieldConfig.overrides[] | select(.matcher.options=="correlation_id") | .properties[0].value[0].url | test("var-correlation_id=\\$\\{__data.fields.correlation_id\\}") and test("__url_time_range"))'
```

---

## T2 — Add the companion "Orphan events" stat panel ✅ DONE

Panel inserted as `panels[1]`; jq acceptance check passed.

Insert as the SECOND element of `panels[]`. Cheap single aggregate:
`SELECT count(*) AS orphan_events FROM tracking.tracked_events WHERE $__timeFilter(occurred_at) AND correlation_id IS NULL`.
`type:"stat"`, `gridPos {"h":8,"w":4,"x":20,"y":0}`, same `tracking-postgres` datasource,
description explains it counts drift/non-envelope rows that never appear in the list.

**Files to modify:**
- `infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml`.

**Acceptance check:**
```bash
cd /Users/chris/sources/yoizen/platform-cluster
yq '.data."message-traces.json"' infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml | jq -e \
  '.panels[1].title=="Orphan events (no correlation_id)"
   and .panels[1].type=="stat"
   and .panels[1].gridPos.x==20 and .panels[1].gridPos.y==0
   and (.panels[1].targets[0].rawSql | test("correlation_id IS NULL"))'
```

---

## T3 — Shift the three existing panels down (y += 8) ✅ DONE

y updated to 8/20/32; h/w/x and queries/links byte-identical; jq acceptance check passed.

Only the `y` of the three pre-existing panels changes; `h`/`w`/`x` and all queries/links
stay byte-identical:
- Trace waterfall (Tempo): `y: 0 → 8`
- Causal node graph: `y: 12 → 20`
- Trace events (detail): `y: 24 → 32`

**Files to modify:**
- `infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml`.

**Acceptance check:**
```bash
cd /Users/chris/sources/yoizen/platform-cluster
yq '.data."message-traces.json"' infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml | jq -e \
  '(.panels[] | select(.title=="Trace waterfall (Tempo)").gridPos.y)==8
   and (.panels[] | select(.title=="Causal node graph").gridPos.y)==20
   and (.panels[] | select(.title=="Trace events (detail)").gridPos.y)==32
   and ([.panels[] | select(.title|test("Trace|Causal")) | .gridPos.x] | all(.==0))'
```

---

## T4 — JSON + kustomize build validation ✅ DONE

panels length == 5 confirmed; `kubectl kustomize infrastructure/base/observability` builds clean.

Confirm the whole ConfigMap still parses and Kustomize builds clean after the edits.

**Acceptance check:**
```bash
cd /Users/chris/sources/yoizen/platform-cluster
yq '.data."message-traces.json"' infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml | jq -e '.panels | length == 5' >/dev/null
kubectl kustomize infrastructure/base/observability >/dev/null && echo "kustomize OK"
```

---

## T5 — SQL correctness against the live dev fixture chain ✅ DONE

Ran via `kubectl exec -i -n support-services-dev postgres-0 -- psql -U yoizen -d yoizen`
(no local `psql`; DB user is `yoizen`/`yoizen`, not `POSTGRES_URL`/generic `postgres` role
as the doc snippet assumes — see apply-progress.md). Fixture id
`8c2479be-95c1-460f-bbd7-a9b79312952c` returned `event_count = 11`, `entry_kind =
webhook_received`, `terminal_kind = sent`. Orphan count over the same 30-day window:
16092.

Run the recent-traces CTE and orphan-count SQL against dev Postgres, substituting a concrete
window for the `$__timeFilter(occurred_at)` macro, and assert the ingested telegram chain
appears with whole-trace aggregates.

**Acceptance check** (port-forward dev Postgres first, per `DOCS/guides/trace-console.md`):
```bash
# kubectl port-forward -n support-services-dev svc/postgres 5432:5432 &
psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 <<'SQL'
WITH recent_ids AS (
  SELECT DISTINCT correlation_id FROM tracking.tracked_events
  WHERE occurred_at > now() - interval '30 days' AND correlation_id IS NOT NULL
)
SELECT t.correlation_id,
       min(t.occurred_at) AS start_ts,
       (array_agg(t.kind ORDER BY t.occurred_at ASC))[1]  AS entry_kind,
       count(*) AS event_count,
       (array_agg(t.kind ORDER BY t.occurred_at DESC))[1] AS terminal_kind
FROM tracking.tracked_events t
JOIN recent_ids r ON r.correlation_id = t.correlation_id
GROUP BY t.correlation_id
ORDER BY start_ts DESC
LIMIT 50;
SQL
```
Pass criteria: at least one row returned; the fixture id
`8c2479be-95c1-460f-bbd7-a9b79312952c` shows `event_count = 11`. Also run the orphan count:
```bash
psql "$POSTGRES_URL" -c "SELECT count(*) FROM tracking.tracked_events WHERE occurred_at > now() - interval '30 days' AND correlation_id IS NULL;"
```
(Interval is a test-time stand-in for `$__timeFilter`; the dashboard uses the real macro.)

---

## T6 — Live Grafana provisioning smoke ✅ DONE

DEVIATION (environment, not content): the literal `kubectl apply -f
.../dashboards-message-tracking-configmap.yaml` command (no `-n`) targets whatever
namespace the current context defaults to — this cluster's context has no default
namespace, so it created a STRAY duplicate ConfigMap in `default`. The real ConfigMap
consumed by Grafana lives in `support-services-dev` (set via
`infrastructure/overlays/orbstack/dev/kustomization.yaml`'s `namespace:` field, not by the
base file's `kubectl apply -f` alone). The stray `default`-namespace ConfigMap was deleted
and the correct one applied with `-n support-services-dev`. Note: `kubectl kustomize
infrastructure/overlays/orbstack/dev` currently panics (pre-existing kustomize/PatchTransformer
crash, unrelated to this change — not investigated further, flagged as a risk below) so the
overlay-based apply path could not be used; the direct namespaced apply was used instead.
`kubectl rollout restart/status deployment/grafana -n support-services-dev` succeeded.
Port-forwarded `svc/grafana` locally and confirmed: `GET
/api/dashboards/uid/message-traces` → 200, `panels | length` → 5, `panels[0].title` →
"Recent traces", `panels[1].title` → "Orphan events (no correlation_id)".

Apply the updated ConfigMap and confirm Grafana re-provisions the dashboard with 5 panels.

**Acceptance check:**
```bash
cd /Users/chris/sources/yoizen/platform-cluster
kubectl apply -f infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml
kubectl rollout restart deployment/grafana -n support-services-dev   # picks up the mounted ConfigMap
kubectl rollout status deployment/grafana -n support-services-dev
# kubectl port-forward -n support-services-dev svc/grafana 3000:3000 &
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/dashboards/uid/message-traces   # -> 200
curl -s http://localhost:3000/api/dashboards/uid/message-traces | jq '.dashboard.panels | length'  # -> 5
```
Document exact commands + results in the completion note.

---

## T7 — Update the trace-console guide ✅ DONE

Rewrote step 1 to lead with the Recent traces table; kept SQL one-liner + `$correlation_id`
textbox + admin-console page as fallbacks; added the occurred_at-vs-ingested_at replay
caveat and the orphan/drift-invisibility note. `rg` acceptance check passed.

Amend `DOCS/guides/trace-console.md` "trace a message in 30 seconds": lead step 1 with the
in-dashboard **Recent traces** table (set time picker → read table → click row; no GUID to
remember). Keep the SQL one-liner and `$correlation_id` textbox as documented fallbacks. Add
the one-line caveat: "recent" = `occurred_at` (producer time), replay/backfill sorts by
producer time, and orphan/drift events are counted in the "Orphan events" stat but never
listed. Reaffirm the non-duplication boundary (still the operational view; admin-console
`/processes/trace` stays the product view).

**Files to modify:**
- `DOCS/guides/trace-console.md`.

**Acceptance check:**
```bash
cd /Users/chris/sources/yoizen/platform-cluster
rg -q "Recent traces" DOCS/guides/trace-console.md \
  && rg -q "occurred_at" DOCS/guides/trace-console.md \
  && rg -q "Orphan events" DOCS/guides/trace-console.md \
  && echo "guide updated"
```

---

## T8 — CHECKPOINT (human, visual)

Run `port-forward.sh`, open `/d/message-traces` with a "recent" time window:
1. "Recent traces" table renders one row per correlation_id, ordered by start_ts DESC,
   entry/terminal kind legible (`—` for null-kind traces), tenant column present.
2. Clicking a row's correlation_id opens the SAME dashboard with `var-correlation_id` set
   AND the time window preserved; panels 1-3 (waterfall / node graph / detail) render that
   trace.
3. "Orphan events" stat shows a plausible count; description explains drift invisibility.
4. The `$correlation_id` textbox still works as the escape hatch (paste a known id).
5. User verdict: approve, or list adjustments (become new tasks appended here).

**Acceptance check:** explicit user approval recorded in this file + engram
(`topic: tracking/recent-traces-checkpoint`).

---

## Review Workload Forecast

- **Estimated changed lines**: ~90–130. New table panel (~55) + orphan stat (~20) + 3 `y`
  edits (3) + guide edits (~15). Well under the 400-line budget.
- **Files touched**: 2 (`dashboards-message-tracking-configmap.yaml`, `trace-console.md`).
- **Chained PRs recommended: No.** Single PR.
- **400-line budget risk: Low.** Decision needed before apply: No.

---

## Migration notes

- Pure dashboard/doc change: no schema, no code, no `connector-detail.json` edit.
- Provisioned JSON only — rollback = `git revert` + re-apply the ConfigMap.
- No new datasource, no new template variable, no new interpolation debt (macro-only SQL).
- `$tenant` remains display-only; wiring it is a follow-up after the composite index.
- **Prod prerequisites (separate future changes, NOT this PR)**: composite index
  `(correlation_id, occurred_at)` via `CREATE INDEX CONCURRENTLY`; `tracked_events`
  retention/partition policy. See `adr.md` → Consequences.
- "recent" is `occurred_at` (producer time, indexed), NOT `ingested_at` — replay/backfill
  positions traces by original producer time.
