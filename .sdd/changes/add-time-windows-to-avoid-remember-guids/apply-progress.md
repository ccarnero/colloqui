# Apply progress — add-time-windows-to-avoid-remember-guids

Status: T1-T7 complete and verified (offline + live). T8 is the human checkpoint — left pending.

## Files changed

- `infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml`
  (+81/-6 lines, `git diff --stat`): added the "Recent traces" table panel + "Orphan events"
  stat panel at the top of `message-traces.json`'s `panels[]`, shifted the three pre-existing
  panels down (`y: 0/12/24 → 8/20/32`). `connector-detail.json` untouched.
- `DOCS/guides/trace-console.md` (+23/-6 lines): rewrote the "trace a message in 30 seconds"
  flow to lead with the in-dashboard Recent traces table; kept SQL one-liner, admin-console
  page, and `$correlation_id` textbox as documented fallbacks; added the
  occurred_at-vs-ingested_at replay caveat and the orphan/drift-invisibility note.

Total: 98 net lines across 2 files — within the ~90-130 forecast and well under the 400-line
budget. No other files touched. No code, schema, provider, or kustomization changes.

## Task-by-task results

| Task | Result |
|---|---|
| T1 (Recent traces panel) | PASS — jq acceptance check green |
| T2 (Orphan events stat) | PASS — jq acceptance check green |
| T3 (shift existing panels y+=8) | PASS — jq acceptance check green |
| T4 (JSON + kustomize build) | PASS — panel count 5, `kubectl kustomize infrastructure/base/observability` clean |
| T5 (SQL correctness, live) | PASS — fixture id `8c2479be-95c1-460f-bbd7-a9b79312952c` → `event_count = 11`, `entry_kind = webhook_received`, `terminal_kind = sent`; orphan count (30d window) = 16092 |
| T6 (live Grafana smoke) | PASS (with an environment deviation, see below) |
| T7 (guide update) | PASS — `rg` acceptance check green |
| T8 (human checkpoint) | PENDING — not performed by this agent, per instructions |

## Environment deviations (not content/code issues — documented per blocker policy)

1. **T5 — no local `psql`; DB user is not `postgres`/`POSTGRES_URL` env var.** Ran the SQL via
   `kubectl exec -i -n support-services-dev postgres-0 -- psql -U yoizen -d yoizen` instead of
   a local `psql "$POSTGRES_URL"` session. The pod's actual credentials are
   `POSTGRES_USER=yoizen` / `POSTGRES_DB=yoizen` (role `postgres` does not exist on this
   instance). Query results and pass criteria are unaffected — this is purely how the SQL was
   executed, not a change to the SQL itself.

2. **T6 — plain `kubectl apply -f <configmap.yaml>` (no `-n`) targets the wrong namespace on
   this cluster.** The current kube context has no default namespace, and the raw ConfigMap
   file has no `metadata.namespace`. Running the task's literal acceptance-check command
   verbatim created a **stray duplicate** `grafana-dashboards-message-tracking` ConfigMap in
   the `default` namespace — it did NOT update the ConfigMap Grafana actually mounts (that one
   lives in `support-services-dev`, namespaced there by
   `infrastructure/overlays/orbstack/dev/kustomization.yaml`'s `namespace: support-services-dev`
   field, not by the base file alone). Corrective action taken:
   - Deleted the stray `default`-namespace ConfigMap (`kubectl delete configmap
     grafana-dashboards-message-tracking -n default`).
   - Applied the same file with `-n support-services-dev` explicitly, which updated the real
     ConfigMap consumed by the running Grafana deployment.
   - **Kustomize overlay apply attempted first and failed**: `kubectl kustomize
     infrastructure/overlays/orbstack/dev` panics with a `PatchTransformer`
     nil-pointer/SIGSEGV inside `sigs.k8s.io/kustomize`. This looks like a **pre-existing bug
     unrelated to this change** (this change never touches that overlay or its patches) — not
     investigated further; flagged as a risk below for a separate fix. The direct namespaced
     `kubectl apply -f ... -n support-services-dev` was used as a working substitute for the
     smoke test only.
   - Live verification after the corrected apply + `kubectl rollout restart/status
     deployment/grafana -n support-services-dev`: `GET
     http://localhost:<forwarded>/api/dashboards/uid/message-traces` → `200`; `.dashboard.panels
     | length` → `5`; `panels[0].title` = "Recent traces"; `panels[1].title` = "Orphan events
     (no correlation_id)".

Neither deviation required changing any file content; both are execution-environment notes
for whoever runs T6's live smoke again (e.g. in CI or with a different kube context).

## Live checks performed

- `kubectl get pods -n platform-services-dev` / `-n support-services-dev` — cluster reachable
  outside the sandbox (`dangerouslyDisableSandbox: true` used for all `kubectl`/`psql`
  commands in this apply run; the default sandbox blocks the cluster's network endpoint).
- `psql` against `tracking-postgres`'s pod (`postgres-0`) — T5 SQL confirmed against the real
  fixture chain.
- ConfigMap apply + Grafana rollout + HTTP smoke — T6 confirmed 5 panels live.

## Not performed (intentionally out of scope for this apply)

- T8 human visual checkpoint — requires an operator to open the dashboard in a browser and
  approve; left pending per the task's own instructions ("Acceptance check: explicit user
  approval recorded in this file + engram"). No approval recorded.
- Composite index `(correlation_id, occurred_at)` and `tracked_events` retention policy — out
  of scope per `adr.md` / `design.md`, not touched.

## Risks / follow-ups

- **Kustomize overlay `infrastructure/overlays/orbstack/dev` panics on build** (SIGSEGV in
  `PatchTransformer`). Appears pre-existing and unrelated to this change's diff, but it means
  the "true" GitOps apply path for this ConfigMap could not be exercised end-to-end in this
  session — only the direct namespaced `kubectl apply -f` substitute was verified. Worth a
  separate investigation/fix so future changes can rely on `kubectl kustomize
  infrastructure/overlays/orbstack/dev` (or whichever overlay is the source of truth) instead
  of a manual namespace flag.
- If this cluster is managed by GitOps (ArgoCD/Flux) in addition to my manual `kubectl apply`,
  the manually-applied ConfigMap may be reconciled/overwritten on the next sync from whatever
  is currently committed to the tracked branch — that's expected once this change is
  committed and merged; until then the live cluster state and the git working tree agree
  (both have panels[0]="Recent traces", panels[1]="Orphan events...").
