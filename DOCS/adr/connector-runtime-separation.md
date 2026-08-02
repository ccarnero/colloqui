---
status: accepted
date: 2026-06-12
decision-makers: Architect
consulted: ""
informed: ""
---

# ADR: Why connector-runtime is separate

> Extracted verbatim from `DOCS/guides/onboarding.md` on 2026-07-30
> (`manual-loops/architecture/docs-consistency.md` T05). The record first
> entered the repo in commit `cbbdca6c` (2026-06-12), which is the `date`
> above. Body preserved as recorded — see "Later observations" for drift.
>
> Related decision-log entries: none. `DOCS/architecture/decision-log.md`
> has no D-number covering connector-admin / connector-runtime separation.

**Decision**: Split connector configuration (`connector-admin`) from connector execution (`connector-runtime`).

**Rationale**:
- Configuration ownership and execution have very different scaling profiles: `connector-admin` is a low-volume CRUD API, while `connector-runtime` is a network-bound, high-concurrency Temporal worker (200 parallel).
- Separate task queues allow `connector-runtime` to scale independently via KEDA without affecting the admin API.
- The runtime exposes generic HTTP execution activities (`endpointCall`, `serviceCall`) that are reusable by any Temporal client, not just the workflow service.
- `connector-admin` owns multi-tenant config + credentials and the registry-driven internal-sync surface; keeping that out of the worker minimises blast radius for execution-side incidents.

**Tradeoff**: Two-hop dispatch (workflow → `connector-runtime` → external HTTP) adds latency vs. inline HTTP calls.

**Mitigation**: For latency-sensitive integrations, call `connector-runtime` directly via Temporal client instead of going through `workflow-service`.

---

## Later observations

Recorded here rather than edited into the decision above, because a decision
record states what was decided at the time.

- The rationale cites "200 parallel" activities. The worker now sets
  `maxConcurrentActivityTaskExecutions: 400` in
  `services/connector-runtime/src/worker.ts`. The decision itself is
  unaffected; only the number moved.
- The rationale says "generic HTTP execution activities (`endpointCall`,
  `serviceCall`)". A third has since joined them on the same task queue:
  `mcpCall` (`src/activities/mcp-call.activity.ts`). The separation argument is
  unchanged; the activity set grew.
- The rationale assumes KEDA-based scaling. KEDA is not in the codebase — guard
  K6b in `scripts/checks/doc-code-guards.sh` actively fails on any live
  `ScaledObject`, and developer mode runs a fixed replica count. The
  independent-scalability argument still holds via replica count; the
  *mechanism* named in the record no longer exists.
