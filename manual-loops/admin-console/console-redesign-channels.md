# SPEC — Console redesign: Channels (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-foundation.md` (must be shipped).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-channels'.

## Goal

The Channels section shows the account fleet as an operational view: fleet
metrics, inventory table (per-account health dot, message sparkline, status),
a needs-attention panel for degraded accounts, and an account detail view with
per-channel breakdown — matching the design contract.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "Channels" + "Channel detail" sections of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshots).
2. Account detail keeps its existing route
   (`/channels/:channel/accounts/:accountId` →
   `detail/channel-detail.component.ts`); a row click navigates to it.
3. Health status mapping (dot color) is derived from existing status fields —
   the exact mapping is decided at T01 review with the human if ambiguous.
4. No new API endpoints; existing channels/accounts services are the source.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `services/admin-console/src/app/features/channels/` —
  `channels-landing.component.ts`, `channels.component.ts`
  (`/channels/:channel`), `detail/channel-detail.component.ts`,
  `account-dialog.component.ts`; reuse logic, replace presentation.
- `core/services/channel-admin.service.ts`, `core/services/adapters.service.ts`;
  models `channel-account.model.ts`, `channel-streams.model.ts`,
  `adapter-status.ts`.
- `src/app/shared/components/` — foundation primitives; consume, never fork.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex.
- Only the channels feature folder (+ routes for the detail view) is touched.

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

- Map the channels feature: routes, components, services, account/channel
  models, status fields available for the health mapping (decision 3).
  Record "**T01 findings (recorded <date>):**" in this SPEC.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-channels.md
```

### T02 — Fleet list view

- Rebuild the channels list: MetricCard fleet row, InventoryTable of accounts
  (health dot, sparkline, status), NeedsAttentionPanel of degraded accounts.
- Unit tests: health mapping per decision 3, empty fleet, row click emits
  navigation to detail route.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Account detail view

- Routed detail view per decision 2: account header (status, identifiers),
  per-channel breakdown table, recent errors/needs-attention for that account.
- DO NOT duplicate list-view logic — share models/services.
- Unit tests: route param resolves account; unknown id shows not-found state.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Docs + index

- Update `services/admin-console/README.md`, add entry to `cowork/INDEX.md`, log the
  health-status mapping decision to Engram topic
  'admin-console/redesign-channels'.

**Accept**
```
grep -n "console-redesign-channels" cowork/INDEX.md
```

---

- [ ] T01 inventory report
- [ ] T02 fleet list view
- [ ] T03 account detail view
- [ ] T04 docs + index

## Out of scope (explicit)

- Channel provisioning/creation flows — behavior unchanged, restyle only if
  trivially composed from primitives; otherwise report finding.
- Backend/API changes — front-only.
- Notification/alerting features — needs-attention is a view, not an alerter.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Health-status mapping (decision 3) is confirmed by the human after T01 if
  the existing fields are ambiguous.
- Deviating from the binding visual contract requires human sign-off.
