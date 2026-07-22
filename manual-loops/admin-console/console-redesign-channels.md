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
# G5a — COMMIT GATE (once per task): dev-mode smoke — ng serve boots and serves the shell
cd services/admin-console && node scripts/dev-smoke.mjs
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

**T01 findings (recorded 2026-07-22):**

0. **Prior-art correction — `adapters.service.ts` / `adapter-status.ts` are
   NOT used by the channels feature.** The Prior art section (lines 33-35)
   lists `core/services/adapters.service.ts` and `adapter-status.ts`
   alongside `channel-admin.service.ts` as if both back the channels
   fleet. Confirmed by usage grep: `AdaptersService`/`AdapterStatus` are
   imported only by `features/automation/ai/ai.component.ts`,
   `tool-adapter-form.component.ts`, `tool-config.component.spec.ts`, and
   `knowledge-base-*` (all AI "tool adapter" HTTP-integration UI) — never
   by anything under `features/channels/`. `AdapterStatus` (`"enabled" |
   "disabled"`, `services/admin-console/src/app/core/models/adapter-status.ts:2`)
   is the HTTP-adapter enable/disable flag for the AI tool-integration
   layer, unrelated to channel accounts. T02/T03 must not import
   `AdaptersService` — it is out of scope for this SPEC.

1. **Routes** (`services/admin-console/src/app/app.routes.ts`):
   - `/channels` → `ChannelsLandingComponent` (lines 42-48,
     `channels-landing.component.ts`) — landing/aggregate view.
   - `/channels/:channel` → `ChannelsComponent` (lines 49-55,
     `channels.component.ts`) — per-channel accounts table (current
     "fleet" list, filtered by the `:channel` path segment).
   - `/channels/:channel/accounts/:accountId` → `ChannelDetailComponent`
     (lines 56-62, `detail/channel-detail.component.ts`) — matches user
     decision 2, route unchanged.

2. **`channels-landing.component.ts`** (267 lines) — aggregate dashboard,
   not the fleet inventory. Renders via `SectionLandingShellComponent`:
   4 KPI cards (`connectedSummary`/`reauthSub` lines 191-205,
   `messages24hLabel`/`messagesDirSub` 207-223, plus 2 static "coming
   soon" cards for auto-reply hit rate / p95 response — **no data
   source**), a hardcoded 3-row "Traffic by channel" list (WhatsApp/
   Telegram/HTTP, `channels` computed lines 225-244, status hardcoded to
   `"ok"` for all three — **not derived from any real per-channel
   health**), and a "Recent failed deliveries" panel bound to
   `recentFailures` (line 251) which is a computed literal `[]` — always
   empty, no data source wired.

3. **`channels.component.ts`** (376 lines) — the actual per-channel
   accounts table (target for T02's fleet rebuild). Columns: name (link
   to detail, 156-166), externalId (168-173), status badge
   (175-183, `a.isActive ? 'Active'/green : 'Inactive'/red` — the ONLY
   status source), createdAt (185-190), actions (edit/delete, 192-202).
   Stat cards above the table: Total/Active/Inactive accounts (139-152,
   derived client-side from `filteredAccounts()`, lines 280-286). Data
   source: `ChannelAdminService.listAccounts()` (line 364,
   `loadAccounts()`), filtered client-side by `channelFilter` signal
   bound to the `:channel` route param (ngOnInit, lines 310-315). No
   message counts, no sparkline data, no delivery/response metrics
   fetched here today.

4. **`detail/channel-detail.component.ts`** (509 lines) — the account
   detail view T03 must keep routed as-is (decision 2). Renders: KPI
   cards via `app-kpi-cards` bound to `totals()` (`IUsageTotalsRow[]`,
   line 124), a usage chart (`app-usage-chart`, 136-142), scoped stream
   cards (146-151, ingress/dlq), and (gated by `diagnostics:read`
   permission) a "Recent messages" list linking into
   `/processes/trace/:correlationId` (153-176). Data sources:
   `ChannelAdminService.getUsage()`/`getUsageTotals()` (350-363, scoped
   by `accountId`+`channel`), `MessageTraceService.recentTraces()`
   (497-503). **No account header/identity/status block exists in this
   component today** — no rendering of `isActive`, channel name,
   external id, or provider for the account being viewed; the design's
   header chips (name/kind/handle/status, see finding 11) have no
   current UI counterpart here, though the underlying account object is
   never even fetched in this component (only usage/totals/traces are
   queried, scoped by route params — the account entity itself,
   including `isActive`, is not loaded).

5. **`account-dialog.component.ts`** (387 lines) — create/edit modal,
   unchanged by this SPEC (out of scope: "provisioning/creation flows").
   Confirms `IChannelAccount` field set actually editable: channel, name,
   externalId, phoneNumberId, telegramBotToken, accessToken, appId,
   appSecret, verifyToken (271-280) — no status/health fields present in
   the create/edit form.

6. **`core/models/channel-account.model.ts`** (28 lines) — `IChannelAccount`
   fields: `id`, `channel: string`, `provider: string`, `name`,
   `externalId`, optional `phoneNumberId`/`wabaId`/`telegramBotToken`,
   `accessToken`, optional `appId`/`appSecret`/`verifyToken`,
   **`isActive: boolean`** (line 18 — the only boolean status flag),
   optional `createdAt` (list-only). No `health`, no `lastError`, no
   `reauthRequired`, no `lastSeenAt`/`lastMessageAt` field anywhere on
   this model.

7. **`core/models/channel-streams.model.ts`** (67 lines) — usage/stream
   shapes consumed by the detail view: `IUsageBucketRow`
   (`direction: "ingress"|"egress"|"dlq"`, `events: number`, per
   bucket/account/channel), `IUsageTotalsRow` (`direction`, `events`,
   `firstTs`/`lastTs` — **no explicit "failed"/"delivered" counters**;
   delivery success is not modeled — only ingress/egress/dlq event
   counts). `IStreamSummary` (35-48) exposes JetStream-level health
   (`messages`, `consumerCount`, `firstSeq`/`lastSeq`) but is
   stream-scoped, not account-scoped, and is only used by the message
   inspector dialog, not the accounts list/detail.

8. **`core/services/channel-admin.service.ts`** (135 lines) — confirmed
   HTTP surface: `listAccounts()`/`deleteAccount()`/`createAccount()`/
   `patchAccount()`/`listAccountOptions()` (37-62),
   `listAutoReplyRules()`/`deleteAutoReplyRule()`/`createAutoReplyRule()`
   (64-79, out of scope per SPEC), `getUsage()`/`getUsageTotals()`
   (81-100), `getStreams()`/`getStreamMessages()` (102-120). No
   endpoint returns per-account health, delivery rate, or first-response
   time — those are design-only fields (finding 11) with **no backing
   API today**, consistent with constraint "No new API endpoints."

9. **`core/services/metrics/channels-metrics.service.ts`** (139 lines) —
   reconfirms the dashboard loop's finding: **`failedDeliveries24h`
   (line 36) is declared, exposed via `resolve()` (line 131,
   `"channels.failed.24h"`), but never `.set()` anywhere in the file —
   dead signal, permanently `null`.** Additional finding not previously
   recorded: **`connectedCount` (line 32) is set to `accounts.length`
   (line 64) — the SAME value as `totalCount` (line 65) — it does NOT
   filter by `isActive`.** `loadCounts()` (46-75) counts accounts per
   channel but never inspects `isActive` at all. Consequence: on
   `channels-landing.component.ts`, `reauthSub()` (197-205) computes
   `totalCount - connectedCount`, which is always `0` given the current
   service — the landing page's "N need reauth" sub-label can never
   fire today, even when accounts have `isActive === false`. This is a
   second dead/misleading metric alongside `failedDeliveries24h`, and
   directly affects decision 3 (see finding 10).

10. **CRITICAL — status fields available per account, for decision 3
    (health-dot mapping):**
    - **Design ground truth — the design defines exactly 3 health-dot
      states, not 2 and not 4.** The `ACCOUNTS` mock-data array
      (`Rediseño Terminal.dc.html:1368-1387`) sets a `health` field on
      every row with only three literal values: `"ok"` (seven rows, e.g.
      `Ventas AR` line 1369, `Soporte AR` line 1371), `"warn"`
      (`Marketing AR`, line 1375, paired with `delBad:true`), and
      `"down"` (`Soporte MX`, line 1373, paired with `status:"reauth"`).
      The color derivation at line 1693 confirms this is the full
      enum: `dotColor: a.health === "down" ? "var(--red)" :
      a.health === "warn" ? "var(--yellow)" : "var(--green)"` — a
      ternary with exactly 3 branches (red/yellow/green), no fourth
      "idle"/grey branch anywhere in the file. **There is no `"idle"`
      health value in the design** — grep of the design HTML confirms
      zero matches; `idle` exists only in the status-badge primitive's
      `HealthStatus` type (`ok|warn|error|idle`), which is a superset
      not fully used by this screen.
    - **`IChannelAccount.isActive: boolean`**
      (`core/models/channel-account.model.ts:18`) — the only per-account
      status field returned by the API today. Rendered today as a 2-state
      badge: `true` → "Active"/green, `false` → "Inactive"/red
      (`channels.component.ts:178-181`).
    - **No other status-like field exists per account or per channel** —
      no `health`, `lastError`, `reauthRequired`, `deliveryRate`,
      `lastMessageAt`. `IUsageTotalsRow.events`/`firstTs`/`lastTs`
      (finding 7) exist but are usage-range-scoped (fetched only for a
      specific account+time-range in the detail view), not part of the
      accounts list payload, and carry no pass/fail semantics — a `dlq`
      direction with `events > 0` is the closest proxy for "has recent
      failures" but requires an extra `getUsageTotals({accountId,
      direction: 'dlq'})` call per row, which `T02`'s inventory table
      does not currently make (`listAccounts()` returns no usage data).
    - `AdaptersService`/`AdapterStatus` (`"enabled"|"disabled"`) — **not
      applicable**, confirmed unrelated to channel accounts (finding 0).
    - **Candidate mapping A (UNAMBIGUOUS given only existing fields, but
      2-state):** `isActive === true` → primitive `ok`; `isActive ===
      false` → primitive `error` (design `down`). No field distinguishes
      design `warn` — that state has **no data source** with the fields
      available today. The primitive's `idle` value is not needed by
      this design and stays unused under mapping A.
    - **Candidate mapping B (requires a NEW per-row fetch, not just a
      remap — needs human confirmation):** `isActive === false` →
      `error` (design `down`); `isActive === true` AND a per-account
      `dlq` usage-totals call in the same 24h window returns `events >
      0` → `warn`; `isActive === true` AND no recent `dlq` events →
      `ok`. This covers all 3 design states (ok/warn/down) but needs an
      extra `getUsageTotals({accountId, direction: 'dlq'})` call per row
      (N extra calls per fleet-table render), which `listAccounts()`
      does not currently return in a single call.
    - **Verdict: the design needs 3 states — `ok`/`warn`/`down` — mapped
      onto the primitive's `ok`/`warn`/`error` (design `down` = primitive
      `error`; primitive `idle` is unused by this design). Mapping A is
      unambiguous but only distinguishes ok/error (2 of 3 design
      states), never warn. Mapping B covers all 3 design states
      (ok/warn/down→error) but adds N extra HTTP calls per fleet-table
      render (one `getUsageTotals` per account) that constraint 4 ("no
      new API endpoints") does not forbid but the current
      `listAccounts()` response does not support in a single call —
      human must confirm at T01 review whether T02 may do N per-row
      usage-totals calls, or must ship with only ok/error (mapping A)
      and treat `warn` as an unreachable state for now.**

11. **Design contract — "Channels" fleet section**,
    `manual-loops/admin-console/design/Rediseño Terminal.dc.html` lines
    246-331 (`data-screen-label="Channels"`, line 248), confirmed against
    `design/02-channels-fleet.png`. Contents, top to bottom:
    - Header (249-255): title/subtitle + "Add channel" button — data
      source: none needed (static + existing `openCreate()`/`newChannel()`
      pattern in `channels.component.ts`/`channels-landing.component.ts`).
    - 4-column "Flota" metric strip (257-278): messages 24h
      (in/out split) — **has a data source**
      (`ChannelsMetricsService.messagesIn24h`/`messagesOut24h`, computed
      today in `channels-landing.component.ts:207-223`); delivery rate %
      + "N fallidas · 24h" — **FLAG: no data source** (no
      delivered/failed counters anywhere, see finding 7 — `dlq` direction
      events is the closest proxy but is not a delivery-rate calculation
      and is not currently aggregated fleet-wide); "conversaciones ·
      últimos 15 min" — **FLAG: no data source** (no conversation concept
      in any model read); "1ª respuesta" (first response time) — **FLAG:
      no data source** anywhere in channel-service-facing models/services.
    - Accounts inventory table (280-300): columns Cuenta (name + health
      dot + kind), Identidad (handle), Estado (status badge), Msgs·24h +
      sparkline, Deliv. (delivery %), 1ª resp, Workflows (`usedBy`), chevron.
      - `name`/`kind`/`handle` (channel+externalId) — **has a data
        source** (`IChannelAccount.name`/`.channel`/`.externalId`).
      - `dotColor`/health — see finding 10 (CRITICAL, partial source only).
      - `statusLabel`/`statusColor` ("needs reauth"/"connected") — **has
        a data source**, derivable from `isActive` (same field, second
        rendering — design implies a `reauth`-specific state distinct
        from generic "inactive", which `isActive` cannot distinguish;
        today `isActive=false` could mean deleted/disabled/reauth-needed
        indiscriminately).
      - `msgs` (24h count) — **FLAG: no per-account data source** in the
        accounts list; would require a per-account `getUsageTotals` call
        (same N-calls issue as finding 10).
      - `spark` (sparkline points) — **FLAG: no data source**; no
        per-account time-bucketed series is fetched anywhere except in
        the single-account detail view (`getUsage`, scoped to one
        account+range at a time, finding 4).
      - `delivered`/`resp` (delivery % / first response time) — **FLAG:
        no data source**, same gap as the fleet strip.
      - `usedBy` (workflows referencing this account) — **FLAG: no data
        source**; no channel-account ↔ workflow relationship is exposed
        by any service read in this report.
    - "Necesita atención" + "Actividad" 2-column row (302-329): needs-
      attention items reference token-expired accounts, error-code
      spikes, webhook p95 — **FLAG: no data source** for any of these
      (no error-code/webhook-latency data available to admin-console for
      channel accounts); activity feed items (delivery failures,
      template approvals, bot-blocked, reconnect events) — **FLAG: no
      data source**, this is an audit/event-log concept not present in
      any model read (closest existing UI is the unused
      `ActivityFeedComponent` + always-empty `recentFailures` in
      `channels-landing.component.ts`, finding 2).

12. **Design contract — "Channel account detail" section**, same file,
    lines 1108-1189, confirmed against `design/03-channel-account-detail.png`.
    Contents, top to bottom:
    - Header (1110-1127): back button, name, kind, handle, status badge,
      6h/24h/7d/30d range selector, conditional "Reconnect" button (only
      when `cdReauth`), Refresh button. Name/kind/handle/status —
      **partially has a data source** (same `IChannelAccount` fields as
      finding 11, but as noted in finding 4, `channel-detail.component.ts`
      never actually fetches the account entity — only `channel`/
      `accountId` route params are used to scope usage/traces queries).
      Range selector — **has a data source**, matches existing
      `app-range-selector` (`range-selector.component.ts`, already wired
      in `channel-detail.component.ts:107-110`). Reconnect button —
      **FLAG: no action wired anywhere** (no reconnect/reauth API call in
      `ChannelAdminService`).
    - 5-KPI row (1129-1135): Received, Sent, Delivered %, Failed, 1ª
      respuesta. Received/Sent — **has a data source** (`IUsageTotalsRow`
      ingress/egress `events`, already rendered via `app-kpi-cards`,
      finding 4). Delivered %/Failed/1ª respuesta — **FLAG: no data
      source** (same delivery/response gap as fleet strip, finding 11).
    - Usage chart (1137-1149) — **has a data source**, matches existing
      `app-usage-chart` already wired (finding 4).
    - Streams panel (1152-1168) — **has a data source**, close match to
      existing `app-scoped-stream-cards` (already wired, finding 4),
      though the design's per-stream "last seq"/"pending N" fields map to
      `IStreamSummary.lastSeq`/consumer pending count which
      `scoped-stream-cards.component.ts` was not opened in this report —
      flagged for T03 to re-verify field-by-field, not re-derived here.
    - "Mensajes recientes" panel (1170-1186) — **has a data source**,
      matches existing recent-traces list already wired (finding 4,
      `MessageTraceService.recentTraces()`), gated the same way by
      `diagnostics:read`.

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

- [x] T01 inventory report
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
