---
status: accepted
date: 2026-06-12
decision-makers: Architect
consulted: ""
informed: ""
---

# ADR: Why Temporal + NATS (not just Kafka/Event Bus)

> Extracted verbatim from `DOCS/guides/onboarding.md` on 2026-07-30
> (`manual-loops/architecture/docs-consistency.md` T05). The record first
> entered the repo in commit `cbbdca6c` (2026-06-12), which is the `date`
> above.
>
> Related decision-log entries: **D2** ("JetStream, not Core NATS",
> `DOCS/architecture/decision-log.md`) is the adjacent — but narrower —
> decision. D2 settles which NATS delivery mode the bus uses; this ADR settles
> why there is a separate orchestrator at all. D5 ("One stream per tenant with
> explicit limits") governs the resulting stream topology.

**Decision**: Use Temporal for orchestration + NATS for events (not a single message queue).

**Rationale**:
- Temporal provides durable orchestration, retries, timeouts
- NATS provides low-latency event distribution
- Clean separation: Temporal = control flow, NATS = data flow

**Tradeoff**: Two systems to operate and monitor

**Mitigation**: Standard topology, automated via bootstrap scripts

---

## Where this is implemented

Pointers only; the decision text above is unchanged.

- Control flow (Temporal): `services/workflow-service/src/temporal/` and the
  `connector-runtime` worker — see `services/workflow-service/README.md` and
  `services/connector-runtime/README.md`.
- Data flow (NATS JetStream): per-tenant `INGRESS-<tenant>` streams and the
  durable-consumer machinery in `packages/database` — see
  `packages/database/README.md` and `DOCS/messaging/service-bus.md`.
