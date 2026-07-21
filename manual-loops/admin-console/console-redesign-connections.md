# SPEC — Console redesign: Connections (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-foundation.md` (must be shipped).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-connections'.

## Goal

The Connections section shows the connector inventory as an operational view:
fleet metrics, inventory table with health dots and call-volume sparklines, a
needs-attention panel for failing connections, and a connection detail view
(config summary, recent invocations, error breakdown) per the design contract.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "Connections" + "Connection detail" sections of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshots).
2. Detail keeps the existing routes (`/connections/http/:id`,
   `/connections/mcp/:id`); hosted services keep dialog-based editing.
3. Secrets/credentials are never rendered — masked placeholders only.
4. No new API endpoints; existing connections services are the source.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `features/connections/` — `connections-landing.component.ts`,
  `mcp-servers-page.component.ts`, `mcp-detail/mcp-detail.component.ts`.
- `features/data-integrations/connectors/` — `connectors.component.ts`,
  `detail/connector-detail.component.ts`.
- `features/automation/hosted-services/` — component + `service-dialog`,
  `routes-dialog`.
- Services: `connector-call.service.ts`, `http-adapter.service.ts`,
  `registry.service.ts`; shared dialogs `http-adapter-dialog`,
  `mcp-server-dialog`. Forms/dialogs are REUSED, not rewritten.
- `src/app/shared/components/` — foundation primitives; consume, never fork.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex.
- Only the connections feature folder is touched.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — unit tests
cd services/admin-console && pnpm exec ng test --watch=false
# G2 — typecheck
cd services/admin-console && pnpm exec tsc -p tsconfig.app.json --noEmit
# G5b — COMMIT GATE (once per task): production build
cd services/admin-console && pnpm run build
```

Gate rules: identical to `manual-loops/admin-console/console-redesign-foundation.md`.

---

## Task queue

### T01 — Inventory report (no code)

- Map the connections feature: components, services, models, existing config
  forms, what invocation/health data exists. Record "**T01 findings
  (recorded <date>):**" in this SPEC; flag missing health/volume data.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-connections.md
```

### T02 — Inventory list view

- Rebuild the list: fleet MetricCard row, InventoryTable (health dot,
  sparkline, type, status), NeedsAttentionPanel of failing connections.
- Unit tests: mapping to table rows, empty state, row click navigates to the
  detail route.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Detail views restyle

- Restyle `connector-detail` and `mcp-detail` routed views per decision 2:
  config summary (secrets masked per decision 3), recent invocations, error
  breakdown; the EXISTING edit forms/dialogs are embedded unchanged.
- Unit tests: secrets never appear in DOM; form reuse (no duplicated form
  component).

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Docs + index

- Update `services/admin-console/README.md`, add entry to `cowork/INDEX.md`, log
  decisions to Engram topic 'admin-console/redesign-connections'.

**Accept**
```
grep -n "console-redesign-connections" cowork/INDEX.md
```

---

- [ ] T01 inventory report
- [ ] T02 inventory list view
- [ ] T03 detail views
- [ ] T04 docs + index

## Out of scope (explicit)

- New connector types or config schema changes — front-only restyle.
- Backend/API changes.
- Credential rotation/testing features — existing behavior only.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Deviating from the binding visual contract requires human sign-off.
- Any change to how credentials are displayed/masked requires human sign-off.
