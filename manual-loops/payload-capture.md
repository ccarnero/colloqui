# SPEC — Durable payload capture, retention & admin payload viewer

> Task queue for the `/manual-loop` command. One task at a time, gated by tests and
> dual review. Queues live in `manual-loops/`.
> Origin: user decisions 2026-07-11 (Cowork session). Engram topic: `tracking/payload-capture`.

## Goal

Every event payload is durably captured and usable for debugging, with bounded
storage and controlled access:

1. **Capture** — inline payloads are already persisted (`tracked_events.envelope`
   jsonb). The gap is claim-checked payloads (`payload_inline: false`): the ingester
   must RESOLVE `payload_ref` against cache-service at ingest time (before the Redis
   TTL kills it) and persist the full payload.
2. **Retention** — payloads live 30 days; the causal chain (all metadata) lives
   forever. A scheduled scrub empties `envelope.data.payload` on rows older than
   30 days, flagging them.
3. **Access (debug scenario)** — the trace console's event detail can fetch a
   payload on demand: tenant-admin role required, every view emits an audit event.
   Analytics over payloads is OUT of this change (future queue).

## User decisions (human boundary — do not reinterpret)

1. Scope: capture ALL payloads (no per-flow opt-in). Claim-check resolution at ingest.
2. Retention: 30 days for payload content; event rows/metadata unlimited.
   The interval lives in ONE place (env var `PAYLOAD_RETENTION_DAYS`, default 30).
3. Payload viewing: tenant-admin only + audit trail of who viewed what, when.
4. Analytics: separate future queue — do not add analytics surfaces here.

## Prior art (validated 2026-07-11 — REUSE, do not duplicate)

- `tracking.tracked_events.envelope` already persists full inline payloads (this
  SPEC's baseline).
- audit-service `channel_events` already projects channel payload fields to columns
  (`message_text`, `from_id`, `to_id`, `message_type` —
  `channel-audit.postgres.repository.ts:29-45,81-92`). It does NOT resolve
  claim-check (null `message_text` for large messages) and covers channel events
  only. DO NOT extend it here — it stays as-is; the durable payload source of truth
  for the trace console is `tracked_events`.
- `resolveClaimCheckEnvelope` in `packages/database/src/claim-check.ts` is the
  resolution mechanism T02 must wrap — it exists and works; no consumer persists
  its result today.
- No retention policy exists anywhere (only infra TTLs: Redis, NATS stream 7d,
  Temporal 24h). T03 is greenfield.
- Origin note: this feature was already in the user's `backlog.md` (lines 6-7).

## Constraints (apply to every task)

- Same binding styles as `manual-loops/trace-console.md`: ingester = pure functions
  in `src/lib/*`, I/O only in `main.ts`, plain Bun; console = standalone/signals/
  OnPush; gateway = explicit proxy modules, global guards, no `@Public()`.
- Claim-check resolution NEVER blocks ingestion: on resolution failure, persist the
  slim envelope exactly as today + `payload_status = 'unresolved'` + warn log with
  ref and reason. Ingestion latency is the priority.
- Scrub job is IDEMPOTENT and batched (LIMIT + loop), dry-run by default, `--apply`
  to execute. Follows the repo's reset-script convention: Claude writes it, the
  human runs the first `--apply`.
- Schema changes: idempotent SQL in `src/sql/*.sql` via `applySchema`.
  New columns, never repurposed ones.
- The chain list endpoint keeps EXCLUDING payloads (trace-console decision stands);
  payload access is its own endpoint with its own guard.
- Verbose logging; tests with the behavior; never weaken existing tests.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
G1  cd services/tracking-ingester-service && bun test
G2  cd services/tracking-ingester-service && bunx tsc -p tsconfig.json --noEmit
G3  cd services/api-gateway && bun test                  # from T04 onward
G4  cd services/admin-console && pnpm test               # from T05 onward
G5a ITERATION — as in manual-loops/trace-console.md (dev-mode + e2e per attempt;
    admin-console tasks skip G5a; deps sha-check at task start).
G5b COMMIT GATE — as in manual-loops/trace-console.md (dev-mode off +
    rebuild-redeploy of touched services + e2e green on built image).
```

Gate rules: identical to `manual-loops/trace-console.md` (validator PRECONDITION
already green 2026-07-11; full suites in touched services; commits only on built
image).

---

## Task queue

### T01 — Schema: payload lifecycle columns

Idempotent additions to `tracking.tracked_events` (`src/sql/tracked-events.sql`):

- `payload_status text NOT NULL DEFAULT 'inline'`
  CHECK (`inline` | `resolved` | `unresolved` | `scrubbed` | `none`).
  Backfill: existing rows → `inline` when envelope has `data.payload` non-null,
  `none` otherwise.
- `payload_scrubbed_at timestamptz` (nullable).
- Index on `(occurred_at) WHERE payload_status IN ('inline','resolved')` to make
  the scrub scan cheap.
- `TrackedEventRow` type + mapper updated; unit tests for backfill semantics.

**Accept**
```
cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit
grep -n "payload_status" services/tracking-ingester-service/src/sql/tracked-events.sql
```

### T02 — Claim-check resolution at ingest

In the ingester consume path: when `is_claim_check` is true, resolve the payload
BEFORE persisting:

- New pure function `resolve-payload.ts` wrapping
  `resolveClaimCheckEnvelope` (`packages/database/src/claim-check.ts`) — reuse,
  do not reimplement.
- Success → persist envelope WITH payload, `payload_status = 'resolved'`.
- Failure (expired ref, cache down, malformed) → persist slim envelope as today,
  `payload_status = 'unresolved'`, warn log with `payload_ref` + reason. NEVER
  throw into the consumer loop; NEVER nack the message for a resolution failure.
- Config: `CLAIM_CHECK_RESOLVE_TIMEOUT_MS` (default 2000).
- Unit tests: success, expired, timeout, cache unreachable, malformed ref.

**Accept**
```
cd services/tracking-ingester-service && bun test
```

### T03 — Retention scrub (script + CronJob)

- SQL + pure function: batched scrub —
  `envelope.data.payload := null`, `payload_status = 'scrubbed'`,
  `payload_scrubbed_at = now()` for rows with
  `occurred_at < now() - interval '<PAYLOAD_RETENTION_DAYS> days'` and
  `payload_status IN ('inline','resolved')`. Batches of 5000, loop until zero.
- `scripts/scrub-payloads.sh` (or bun script in the service): DRY-RUN by default
  (prints candidate count per tenant), `--apply` to execute, idempotent, verbose.
- k8s CronJob manifest (daily, off-peak) in `knative/services/base/`, registered in
  kustomization, using the service image + the script entrypoint. Env from the same
  Secret/env-patch pattern as the worker.
- Unit tests: batching, cutoff math, idempotent re-run (second pass = 0 rows).

**Accept**
```
cd services/tracking-ingester-service && bun test
kubectl kustomize knative/services/base >/dev/null && echo kustomize-ok
```

### T04 — Payload read endpoint + gateway guard + audit event

- Ingester: `GET /chains/:correlationId/events/:eventId/payload` (tenant header
  required) → `{ payload, payload_status }`; 404 unknown event, 410 Gone when
  `scrubbed`, 404 when `none`/`unresolved` (body says why).
- Gateway (`modules/tracking`): mirror route, guarded by tenant-admin permission —
  use the existing `@Permissions()`/scopes mechanism of `AuthGuard` (follow the
  strictest existing admin-guarded route as precedent).
- On every successful payload fetch, the gateway publishes an audit event
  (existing audit-service ingestion path — same mechanism other services use to
  emit audit events): actor, tenant, event_id, correlation_id, timestamp.
- Tests: guard rejects non-admin, 410 for scrubbed, audit event emitted (spy).

**Accept**
```
cd services/tracking-ingester-service && bun test
cd services/api-gateway && bun test
```

### T05 — Console: payload viewer in event detail

In the trace feature's event detail card (causal graph + waterfall selection):

- "View payload" action, visible only when the session user has the admin
  permission (reuse the console's existing permission/role helper — follow how
  admin-only actions are gated elsewhere in the console).
- On click: fetch on demand (never pre-fetched with the chain), render JSON
  pretty-printed, collapsed by default; `scrubbed` → "Payload expired (30-day
  retention)"; `unresolved` → "Payload was not captured (claim-check expired)".
- English strings. Component tests: gated visibility, each payload_status state.

**Accept**
```
cd services/admin-console && pnpm test
```

### T06 — Cluster e2e: payload round-trip

Extend `scripts/e2e-http-workflow.sh`: after the chain assertion stage, fetch the
ingress event's payload via the gateway as the admin user and assert HTTP 200 AND
the payload contains the run's nonce (proves capture end-to-end). Then assert a
second fetch of a fabricated unknown event returns 404.

**Accept**
```
./rebuild-redeploy.sh tracking-ingester-service dev
./rebuild-redeploy.sh api-gateway dev
./scripts/e2e-http-workflow.sh
```

### T07 — Docs + index

- `services/tracking-ingester-service/README.md`: payload lifecycle state machine
  (`inline/resolved/unresolved/scrubbed/none`), retention env var, scrub runbook
  (dry-run → `--apply`), claim-check resolution semantics.
- `DOCS/guides/trace-console.md`: payload viewer + permission + audit trail.
- `cowork/INDEX.md` entry + decision cuádruple (engram topic
  `tracking/payload-capture`).

**Accept**
```
grep -n "payload_status\|PAYLOAD_RETENTION_DAYS" services/tracking-ingester-service/README.md
grep -n "payload-capture" cowork/INDEX.md
```

---

## Progress

- [x] T01 schema payload lifecycle
- [x] T02 claim-check resolution at ingest
- [x] T03 retention scrub + cronjob
- [x] T04 payload endpoint + guard + audit
- [x] T05 console payload viewer
- [ ] T06 cluster e2e payload round-trip
- [ ] T07 docs + index

## Out of scope (explicit)

- Analytics over payloads (future queue: flattened views / derived tables).
- Anonymization/redaction of PII inside payloads (future decision; today the
  guard is role + audit, not content transformation).
- Changing claim-check TTLs or cache-service behavior.
- Per-tenant retention overrides (single global `PAYLOAD_RETENTION_DAYS` for now).

## Human boundaries for this change

- Approving this SPEC before the first run.
- First `--apply` of the scrub script in the live cluster (loop writes, human runs).
- Any change to the 30-day window or to who may view payloads.
- The unresolved-payload alarm threshold: if `payload_status='unresolved'` grows,
  deciding whether to raise cache TTL or ingester priority is a human call.
