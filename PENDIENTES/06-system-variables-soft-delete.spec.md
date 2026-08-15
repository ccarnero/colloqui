# SPEC — system variables: reactivate-on-create (soft-delete fix)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Register (origin + live evidence): `PENDIENTES/06-system-variables-soft-delete.md`.
> User ruling 2026-08-15: fix immediately after the Siri POC's T05 — this is that fix.

## Goal

`agent-admin-service`'s system-variables create must converge instead of 500ing
when a soft-deleted row (`is_active = false`) holds the same `(tenant_id, name)`:
reactivate + update it. A duplicate against an ACTIVE row becomes an explicit
409 (never a raw PostgresError 500). The crm-support-telegram manifest apply
must converge on a cluster that previously hit the loop.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Respect the file's own recorded conventions, verbatim:
  - `create()` serializes `value` with `sql.json()` exactly once (see the
    double-encoding comment in `system-variables.service.ts`) — the ON CONFLICT
    branch must keep that property.
  - The unit-test mock shifts results from a queue per `sql` call (see the
    comment in `update()`); new queries must stay compatible with that mock.
- The 409 must name the conflicting variable in its message; every new branch
  logs (reactivation and conflict paths included) — nothing fails silently.
- No API-shape changes beyond the new 409 on POST: routes, DTOs and success
  payloads stay as they are.
- Scope: `services/agent-admin-service` only (+ this PENDIENTES pair). Do not
  touch the two pre-existing dirty files in the repo
  (`.opencode/opencode.json`, `integrations/channels/http-fanout-telegram/manifest.yaml`)
  and never include them in a commit.

## Gates (run in order)

```
G1 ITERATION — cd services/agent-admin-service && bun test && bunx tsc -p tsconfig.build.json --noEmit
G3 COMMIT GATE (once per task, after G1 green) — bash scripts/checks/doc-code-guards.sh
G4 COMMIT GATE — tasks marked [cluster] only:
     ./rebuild-redeploy.sh agent-admin-service dev
   wait for the rollout, then run the cluster checks in the task's Accept.
```

## Task queue

### T01 — reactivate-on-create + 409 on active duplicate

- `system-variables.service.ts` `create()`: `INSERT … ON CONFLICT (tenant_id, name)
  DO UPDATE SET is_active = true, type = EXCLUDED.type, value = EXCLUDED.value,
  label = EXCLUDED.label, description = EXCLUDED.description, updated_at = NOW()
  WHERE system_variables.is_active = false RETURNING …` — reactivation path
  returns the row; an active duplicate returns no row (DO UPDATE's WHERE fails),
  which the service surfaces as a distinct conflict result (not null-as-404).
- Controller: map the conflict result to HTTP 409 with a message naming the
  variable; keep 201/200 shape for create/reactivate identical to today's create.
- Unit tests (extend `test/unit/system-variables.service.spec.ts` and
  `system-variables.controller.spec.ts`): (a) create over soft-deleted row
  reactivates and updates all mutable fields; (b) create over active row → 409;
  (c) plain create unchanged; (d) `value` still single-encoded (mock-level check).

**Accept**
```
cd services/agent-admin-service && bun test test/unit && bunx tsc -p tsconfig.build.json --noEmit
```

### T02 — [cluster] redeploy + live convergence proof

- `./rebuild-redeploy.sh agent-admin-service dev`, wait for rollout.

**Accept**
G5 (agent-driven, cluster evidence):
1. Soft-delete a scratch variable via the API (`DELETE`), then `POST` the same
   name → 2xx and the row is active again with the new value (DB check).
2. `POST` the same name again while active → 409 naming the variable, and the
   worker/API log shows the conflict branch, not a PostgresError.
3. `yoizen manifests apply -f manifest.yaml --secrets-from-env` in
   `demos/crm-support-telegram` converges (no downstream_error, pending=0) —
   run by the user if the orchestrator lacks permission; paste of the output
   counts as evidence.

## Progress

- [x] T01 reactivate-on-create + 409 (2026-08-15: ON CONFLICT upsert with
      WHERE is_active=false; SystemVariableConflictError → 409 naming the
      variable; 8 tests added, 896 pass, tsc clean, doc-code-guards green.
      2× APPROVED. Reviewer note kept: reactivation overwrites the
      soft-deleted row's historical value by design — the log line is the
      only evidence)
- [x] T02 [cluster] redeploy + convergence proof (2026-08-15: revision 00008
      deployed. Live: POST over soft-deleted scratch var → 201 SAME id,
      value updated, "Reactivated soft-deleted system variable" logged;
      POST over active → 409 naming it, conflict branch logged, no
      PostgresError; `manifests apply` on crm-support-telegram → noop/noop
      on both system variables, full convergence)

## Out of scope (explicit)

- Partial unique index migration (Option B in the register) — rejected in favor
  of reactivation, which preserves soft-delete/undo semantics.
- Any generalization to other soft-deleted entities — separate audit if wanted.
