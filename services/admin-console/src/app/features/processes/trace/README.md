# Message trace

An authenticated debug view that follows a single message across services by its `correlation_id` —
forward (origin → reply) and reverse (any event → origin). It answers "what happened to this
message, end to end, and why?" without hand-crafting `curl` calls or grepping pod logs.

- **Where:** direct authenticated route `/processes/trace`, with deep-link `/processes/trace/:correlationId`. It is under the Processes section URL space but is not currently listed in the Processes sub-nav.
- **Who:** authenticated console users with the `diagnostics:read` permission. The route itself is only under the shell `authGuard`; the trace component gates the view/data load with `auth.hasPermission("diagnostics:read")`. It is not currently listed in the Processes sub-nav.
- **Spec:** `.sdd/changes/processes-message-trace/` (design, ADRs, tasks).

## The two traces

The platform records traceability on two threads (see `cowork/TRACEABILITY-audit.md`):

| Thread | Keys | Where | Lifetime | In this view |
| --- | --- | --- | --- | --- |
| **Business trace** | `correlation_id` / `causation_id` / `depth` | audit DB | durable | rendered natively (the causal chain + pub/sub) |
| **Tech trace** | OTel `traceid` | Tempo | ephemeral | hand-off link only (**Open in Tempo**) |

So the chain you see is the business trace; the tech trace is a deep link out (Tempo for the span
waterfall, Temporal for the run history). We don't redraw those — we link into them.

## Anatomy of a chain

A healthy round trip looks like:

```
received          inbound canonical message            (channel-service → received.v1)
  └ workflow run  the Temporal workflow executed        (workflow_executions, keyed by correlation_id)
      └ reply queued    channelSend command on the bus  (workflow → send.v1, egress will deliver)
          └ reply delivered   provider confirmed delivery (channel-service egress → sent.v1)
```

Key distinction: **reply queued** (`send.v1`) is only the command published to NATS; **reply
delivered** (`sent.v1`) is the egress *shadow event* published **after** the provider (e.g.
Telegram) accepts the message. So a `sent` node is a conclusive delivery confirmation — the green
"reply delivered" / "Round trip complete" verdict comes from it, no live health needed.

Each event also shows its **pub/sub fan-out** — the durable consumers it reaches, including the
silent `audit-service` sink that the causal tree alone would hide:

```
received.v1 → workflow-service/workflow-triggers (→ next)  +  audit-service/channel-audit (sink)
send.v1     → channel-service/channel-egress     (→ next)  +  audit-service/channel-audit (sink)
sent.v1     → audit-service/channel-audit (sink, terminal)         [channel-egress consumes send, not sent]
```

### What each node shows

- the **producing service** as a chip (`channel-service`, `workflow-service`), parsed from the
  subject's producer token (`evt.<tenant>.`**`<producer>`**`.…`);
- **full** `id` / `causation` (and full `correlation` / `traceid` in the keys row);
- **topic**: the NATS subject + the real JetStream **stream** `INGRESS-<TENANT>` (uppercased;
  one stream per tenant captures `evt.<tenant>.>`, so every node is on it — mirrors
  `getTenantStreamName` in `@yoizen/shared`);
- **persisted in**: the table + owning service — `channel_events` (audit-service), `events`
  (audit-service), or `workflow_executions` (workflow-service) — shown **only** when the node is
  actually persisted;
- the **pub/sub fan-out** (the consumer durables) described above.

### Verdicts

| Verdict | Meaning |
| --- | --- |
| `received` | inbound arrived; no reply produced |
| `published-unconfirmed` ("reply queued, not confirmed") | a `send` exists but no `sent` — in flight or failed |
| `replied` ("delivered") | a `sent` event confirms delivery |
| `failed` | downstream failure (Slice 2 consumer health) |

## Using it

### Forward — by correlation (origin → reply)

1. Open `/processes/trace` directly, or follow a deep link to `/processes/trace/:correlationId`.
2. Pick from the **Recent traces** combo (last 10 — each option shows the business `correlation_id`
   *and* its tech `traceid`), or paste a `correlation_id` (mode `correlation`) and **Trace**.
3. Read top → bottom: `received → workflow run → reply queued → reply delivered`.
4. Drill into the tech trace: **Open in Temporal** sits on the workflow-run node (the run); the
   keys row has **Open in Tempo** (OTel spans) when `traceid` resolves.

### Reverse — by event id (reply → origin)

1. Switch the search toggle to **event id**.
2. Paste any downstream event id (e.g. the `reply delivered` id, an error event).
3. It resolves that id → its `correlation_id` (via the gateway by-id routes), loads the same tree,
   flips to **reverse** order with `▲ caused by` connectors, tags your node **"you searched this"**
   and the root **"origin."**
4. The `forward / reverse` toggle flips the reading anytime.

Same data, same tree — only the entry point and reading direction change (the causal chain is a
tree, so it's bidirectional). Reverse currently bottoms out at the canonical `received` node; the
raw provider webhook lives in a different store (`gateway_audit_events`) and isn't included.

## Where the data comes from

Slice 1 reuses existing gateway endpoints; the workflow node/link needs the small Option-A backend
addition (already shipped).

| Purpose | Call |
| --- | --- |
| Recent combo (last 10) | `GET /api/audit/channel-events?from={now-24h}&limit=500` → grouped by `correlation_id` client-side, newest 10 (with `traceid`) |
| Trace (channel) | `GET /api/audit/channel-events?from={now-60m}&limit=500` → filtered by `correlation_id` client-side |
| Trace (platform) | `GET /api/audit/events?from={now-60m}&limit=500` → filtered client-side (best-effort) |
| Workflow run + Temporal id | `GET /api/workflows/executions?correlation_id={cid}` |
| Reverse resolve | `GET /api/audit/channel-events/{id}` → fallback `GET /api/audit/events/{id}` → `correlation_id` |

> **Gateway constraint.** The audit proxy whitelists only `from`/`to`/`limit` (not
> `correlation_id`) and exposes list + by-id but not `chain/:id`. That's why the chain is assembled
> **client-side** from a time window. The `correlation_id`-scoped path is workflow-service only
> (executions); for arbitrary-age audit lookup see Slice 1.5 in the SDD tasks.

## Configuration

`services/admin-console/src/environments/environment*.ts`:

| Key | Default (dev) | Notes |
| --- | --- | --- |
| `temporalUiBaseUrl` | `http://localhost:8233` | Temporal UI base. Reach it with `kubectl port-forward svc/temporal-ui 8233:8233`. Empty → link hidden. |
| `tempoBaseUrl` | `""` | Tempo/Grafana explore base for the `traceid` link. Empty → link hidden. |
| `temporalNamespace` | `default` | Temporal namespace for the deep link. |

Access: authenticated shell route (`authGuard`) plus component-level `diagnostics:read` gate. No route-level permission guard is currently implemented.

## Limitations (honest)

- **60-minute window.** `getTrace` filters a time window client-side, so it resolves correlations
  from roughly the last hour — fine for live debugging. Arbitrary-age lookup = Slice 1.5.
- **No backfill.** `workflow_executions.correlation_id` is populated only for runs created after the
  Option-A rebuild, so the workflow node + Temporal link appear for messages sent after it.
- **Aggregate health.** The pub/sub health line (pending/redelivery/circuit) is per-durable, not
  strict per-message — Slice 2 (consumer health endpoints) and Slice 3 (per-message delivery)
  upgrade this. Until then the verdict is conclusive for the happy path (via `sent`) and a strong
  hint for failures.
- **Reverse by internal event id only.** Reversing from a raw provider message id (e.g. a Telegram
  `message_id`) needs an extra lookup — not yet wired.

## Manual fallback (when you can't use the UI)

The same data is reachable by hand — useful on a box without the console, or to cross-check.

```bash
GW=http://localhost:8080; HH=api-gateway.platform-services-dev.127.0.0.1.sslip.io
TOKEN=$(curl -s -X POST $GW/api/auth/login -H "Host: $HH" -H 'Content-Type: application/json' \
  -d '{"email":"yclawd@demo.io","password":"admin123","tenant_id":"acme"}' | jq -r .access_token)
auth() { curl -s -H "Host: $HH" -H "Authorization: Bearer $TOKEN" -H 'x-yoizen-tenant: acme' "$@"; }

# in/out messaging events — a received + a sent under one correlationId = full round trip
auth "$GW/api/audit/channel-events?channel=telegram&limit=6" | jq '.events | map({kind, correlationId, createdAt})'

# the run (temporal_workflow_id, status) for a correlation
auth "$GW/api/workflows/executions?correlation_id=<cid>" | jq

# egress delivery result (the 404/circuit story the chain can't show) lives in the worker
kubectl logs -n platform-services-dev -l app.kubernetes.io/name=channel-service-worker \
  -c user-container --tail=80 | grep -iE 'telegram|send|circuit'
```

Telegram send error codes (worker log): `404` = bad bot token · `401` = revoked · `400 chat not
found` = bad chat id · `circuit_open` = breaker tripped (reset with
`kubectl rollout restart deploy/channel-service-worker -n <ns>`).

## Code map

Frontend (`services/admin-console/src/app/`):
- `features/processes/trace/domain/` — `message-trace.model.ts`, `assemble-trace.ts` (pure tree +
  verdict, unit-tested), `transport-topology.ts` (static pub/sub registry).
- `core/services/message-trace.service.ts` — recent list, `getTrace`, `resolveCorrelation`.
- `features/processes/trace/message-trace.component.ts` — the view (forward/reverse, search modes).
- routes in `app.routes.ts`; top sections/sub-nav in `layout/nav/nav.config.ts` and `layout/sub-nav/`; config in `environments/`.

Backend (Option A — run keyed by correlation):
- `packages/shared/src/workflow-schema.ts` — `correlation_id` column + index (idempotent).
- `services/workflow-service/.../executions.{postgres,mongo}.repository.ts`,
  `executions.repository.interface.ts`, `workflows.service.ts`, `workflows.controller.ts`.
- `services/api-gateway/src/modules/workflows/workflows.controller.ts` — proxy route.

## Rebuilds

- Frontend-only change → `./rebuild-redeploy.sh admin-console`.
- Option-A backend → `./rebuild-redeploy.sh workflow-service && ./rebuild-redeploy.sh api-gateway && ./rebuild-redeploy.sh admin-console`.
