# Design — `trace-visualization`

## Complementarity note (T0 — reconciliation with existing traceability UI)

This change reuses the "business trace" vs. "tech trace" split established in
`.sdd/changes/processes-message-trace/design.md` and extends it with an operational
(Grafana/Tempo) layer. Three prior changes already shape the admin-console side of
message traceability:

- **`processes-message-trace`** — introduced the admin-console **Message trace**
  debug view (`/processes/trace/:correlationId`) under `diagnostics:read`. It
  renders the causal chain (`correlation_id`/`causation_id`/`depth`), the pub/sub
  fan-out per subject, and verdict (received-only / replied / published-unconfirmed
  / failed), reusing existing audit endpoints — no new backend. It explicitly treats
  the OTel `traceid` as a **link-out**, not something it redraws in-app ("Tech
  trace ... This view links out rather than redrawing the span waterfall").
- **`channel-trace-entry`** — added a "recent traces" entry point inside the
  channel-detail component of admin-console, feeding the same `/processes/trace`
  view.
- **`connector-call-detail`** — added redacted HTTP request/response detail
  (headers + truncated bodies) for connector endpoint-call events, surfaced in
  admin-console's connector detail view, and links out to
  `/processes/trace/:correlationId` for the owning message.

### The two views, and the boundary between them

| | Admin-console trace page (`/processes/trace/:correlationId`) | Grafana/Tempo trace dashboards (this change) |
|---|---|---|
| Audience | Product / support operator debugging ONE message | Platform engineer doing operational analysis (latency, bottlenecks, cross-trace patterns) |
| Data source | Audit-service REST endpoints (Postgres audit rows) | Tempo (OTel spans) + `tracking.tracked_events` (Postgres) via Grafana panels |
| Shape | Causal tree + verdict + pub/sub fan-out, rendered in the product's own UI/design system | Native Tempo waterfall + Grafana Node Graph panel + detail table |
| Scope | Single correlation_id at a time, tenant-scoped, permission-gated (`diagnostics:read`) | Any trace by correlation_id, PLUS cross-trace views (connector latency percentiles, error rate, cache hit-rate) that no single-message view can show |
| Lifetime of data | Durable (Postgres audit rows, kept indefinitely) | Ephemeral for spans (Tempo retention window); durable for the Node Graph / detail table (backed by Postgres) |

**Non-duplication boundary (binding):**

1. Grafana/Tempo dashboards (`message-traces.json`, `connector-detail.json`) do
   **NOT** reimplement the admin-console causal-chain view. They are a different
   rendering (native trace waterfall + node graph) aimed at operators who already
   live in Grafana, not a second copy of the product UI.
2. The admin-console trace page **MAY** link out to the Grafana trace dashboard by
   `correlation_id` (mirroring how it already links out to Temporal). This is an
   optional future entry point, not part of this change's Slice; when added it
   follows the same "links render only when the base URL is configured" pattern
   established by `processes-message-trace`.
3. Grafana dashboards MUST NOT gain a business-trace equivalent (verdict computation,
   pub/sub topology annotation) — that logic lives once, in
   `processes/trace/domain/assemble-trace.ts`. If an operator needs the
   product-level verdict, they go to the admin-console page; if they need
   span-level timing/bottleneck analysis or cross-trace aggregates, they go to
   Grafana.
4. Both views key off the SAME identifier (`correlation_id`), so an operator can
   move between them by copy-pasting one value — no separate ID scheme is
   introduced by this change.

This design keeps the two views orthogonal: product/support operators stay in
admin-console; platform engineers doing latency/bottleneck/cross-trace analysis stay
in Grafana. Neither view is a subset implementation of the other.
