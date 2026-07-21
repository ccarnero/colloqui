# SPEC — Console redesign: Users, Analytics, Settings (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-foundation.md` (must be shipped).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-users-analytics-settings'.

## Goal

Users, Analytics, and Settings render in the new visual language: Users as an
inventory table with role/status, Analytics with the metric-card + chart
compositions of the contract, Settings as the grouped-form layout — all
keeping current behavior, permissions, and data sources.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "Users", "Analytics", "Settings" sections of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshots
   `18-analytics.png`, `19-analytics-tables.png`, `17-settings-users.png`).
2. These are restyles: no new capabilities, columns, metrics, or settings.
3. Analytics charts reuse whatever chart approach exists today; if none, use
   the foundation Sparkline plus simple SVG bar/line composition — no chart
   library without human sign-off.
4. No new API endpoints.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `features/identity/users/users.component.ts`;
  `core/services/tenant-users.service.ts`, `role.service.ts`;
  `core/models/user.model.ts`; `core/guards/auth.guard.ts`. Forms and
  guards REUSED unchanged.
- `features/overview/analytics/analytics.component.ts` +
  `core/services/metrics/` — existing metrics only.
- `features/settings-hub/settings-hub.component.ts` — settings hub.
- `src/app/shared/components/` — foundation primitives; consume, never fork.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex.
- Only the three feature folders are touched, one per task — a diff spanning
  two sections is automatic rejection.

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

- Map the three features: components, services, forms, guards, existing
  chart usage in analytics. Record "**T01 findings (recorded <date>):**"
  in this SPEC.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-users-analytics-settings.md
```

### T02 — Users

- InventoryTable of users (role, status, last active), existing actions
  (invite/edit/deactivate) rewired to the new table's row actions; forms and
  guards reused unchanged.
- Unit tests: row mapping, permission-gated actions hidden without rights,
  action wiring identical to old behavior.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Analytics

- MetricCard rows + chart compositions per contract, same metrics as today
  (decision 2), chart approach per decision 3.
- Unit tests: metric mapping, empty/loading states, chart data
  transformation.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Settings

- Grouped-form layout per contract; existing form controls, validation, and
  save paths reused unchanged.
- Unit tests: all existing settings present (snapshot of field ids vs old
  screen), save path untouched.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T05 — Docs + index

- Update `services/admin-console/README.md`, add entry to `cowork/INDEX.md`, log
  decisions to Engram topic 'admin-console/redesign-users-analytics-settings'.

**Accept**
```
grep -n "console-redesign-users-analytics-settings" cowork/INDEX.md
```

---

- [ ] T01 inventory report
- [ ] T02 users
- [ ] T03 analytics
- [ ] T04 settings
- [ ] T05 docs + index

## Out of scope (explicit)

- New user-management capabilities (SSO, roles editor) — restyle only.
- New analytics metrics or date-range features.
- New settings — field set is frozen (decision 2).
- Backend/API changes.
- Roles, API keys, and billing screens (`features/identity/roles`,
  `api-keys`, `tenant-management/billing`) — follow-up loop.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Introducing a chart library requires human sign-off (decision 3).
- Deviating from the binding visual contract requires human sign-off.
