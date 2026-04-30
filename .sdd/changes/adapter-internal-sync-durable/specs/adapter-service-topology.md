# Delta Specification: adapter-service-topology

## Purpose

Process topology of `adapter-service` after this change. The single
deployable is split into two distinct workloads sharing the same image:
`adapter-service-api` (HTTP CRUD, scaled by request load) and
`adapter-service-worker` (durable consumer, scaled by message backlog).
This separation is mandatory because the platform's autoscaler (KEDA)
cannot scale a Knative Service.

## ADDED Requirements

### REQ-AST-001: HTTP CRUD remains on the API workload

**Priority**: P0 (Critical)

The system MUST continue to expose `adapter-service` HTTP CRUD endpoints
from the **api** workload (Knative Service). Tenants' ability to manage
adapters via HTTP MUST be unaffected by this change in steady state and
during rollback.

#### Scenario: HTTP CRUD continues to serve requests

- GIVEN the api workload is healthy and at ≥1 replica
- WHEN a tenant calls a public adapter HTTP endpoint
- THEN the request MUST be served by the api workload with the same
  contract (route, status codes, payloads) it had before this change

#### Scenario: HTTP CRUD survives worker outage

- GIVEN the worker workload is at 0 replicas (scale-to-zero) or unhealthy
- WHEN a tenant calls a public adapter HTTP endpoint
- THEN the api workload MUST still serve the request normally
- AND the api workload MUST NOT be tied to worker readiness

### REQ-AST-002: Durable consumer runs only on the worker

**Priority**: P0 (Critical)

The system MUST run the durable consumer behavior defined in
`adapter-service-internal-sync` **only** on the worker workload. The api
workload MUST NOT bind durable consumers (no fetch loop, no message
processing). Separation of concerns: HTTP request lifecycle MUST not
share runtime resources with message processing.

#### Scenario: Worker processes a backlog message

- GIVEN at least one tenant durable has pending messages
- WHEN the worker workload is at ≥1 replica
- THEN the worker MUST be the only workload that fetches and processes
  those messages

#### Scenario: API workload does not consume

- GIVEN the api workload is running
- WHEN messages are pending on tenant durables
- THEN the api workload MUST NOT fetch any of them
- AND no `ack` / `nak` / `term` operations MUST originate from the api
  workload

#### Scenario: Mode misconfiguration (error)

- GIVEN a process started with an invalid or missing workload-mode setting
- WHEN it boots
- THEN the process MUST refuse to start the durable consumer
- AND it MUST log an explicit configuration error
- AND it MUST exit non-zero rather than silently behaving as one role

### REQ-AST-003: Liveness and readiness endpoints on both workloads

**Priority**: P0 (Critical)

Both the api and the worker MUST expose `/healthz` (liveness) and
`/readyz` (readiness) over HTTP, suitable for Kubernetes probes.

- `/healthz` MUST return 200 while the process is alive and not
  terminating, regardless of dependency state.
- `/readyz` MUST return 200 only when the workload is **functionally**
  ready to do its job (see REQ-AST-004 for the worker's specific gating).

#### Scenario: Liveness during transient dependency outage

- GIVEN the worker is up but NATS is briefly unreachable
- WHEN Kubernetes probes `/healthz`
- THEN it MUST return 200 (the process is alive; the orchestrator should
  NOT restart it for a transient external outage)

#### Scenario: Readiness before dependencies attach

- GIVEN the worker process has just started and has not yet connected to
  NATS or the database
- WHEN Kubernetes probes `/readyz`
- THEN it MUST return non-200 until the readiness conditions in
  REQ-AST-004 are satisfied

#### Scenario: Readiness during graceful shutdown

- GIVEN the worker has received SIGTERM
- WHEN Kubernetes probes `/readyz`
- THEN it MUST return non-200 so traffic and broker fetches drain off

### REQ-AST-004: Worker readiness gated by NATS, DB, and at least one durable

**Priority**: P0 (Critical)

The worker's `/readyz` MUST return 200 only when **all** of the following
are true:

1. NATS connectivity is established (the JetStream client is connected
   and authenticated).
2. Database connectivity for the mirror sink is established.
3. At least one tenant durable consumer is bound and reporting healthy.

If any of those is missing, `/readyz` MUST return non-200 with a brief
machine-readable indication of which gate is failing.

#### Scenario: All gates green

- GIVEN NATS is connected, DB is reachable, and at least one durable is
  bound and healthy
- WHEN `/readyz` is probed
- THEN it MUST return 200

#### Scenario: NATS connection lost (error)

- GIVEN the worker had been ready and the broker connection then dropped
- WHEN `/readyz` is probed
- THEN it MUST return non-200 indicating the NATS gate is failing
- AND the worker MUST attempt to reconnect; once reconnected and a
  durable is healthy again, `/readyz` MUST return 200

#### Scenario: DB unreachable on boot (error)

- GIVEN the worker has just started and the mirror DB is unreachable
- WHEN `/readyz` is probed
- THEN it MUST return non-200 indicating the DB gate is failing
- AND no message MUST be fetched from any durable until the DB gate is
  green

#### Scenario: No durables bound yet

- GIVEN NATS and DB are both healthy but no tenant durable has been bound
  yet (e.g. no `INGRESS-<TENANT>` streams exist yet)
- WHEN `/readyz` is probed
- THEN it MUST return non-200 — the worker is not yet doing useful work

### REQ-AST-005: API workload is exempt from durable readiness

**Priority**: P1 (High)

The api workload's `/readyz` MUST NOT depend on any tenant durable being
bound. Its readiness gate MUST mirror the pre-change contract: process
healthy + database reachable for HTTP CRUD purposes.

#### Scenario: API ready while worker is at 0 replicas

- GIVEN the worker is at 0 replicas (scale-to-zero) and no durable is
  active anywhere in the cluster
- WHEN the api workload's `/readyz` is probed
- THEN it MUST return 200 as long as the api's own dependencies are
  healthy

#### Scenario: API ready during NATS outage

- GIVEN NATS is unreachable from the api pod
- WHEN the api workload's `/readyz` is probed
- THEN the gate MUST NOT fail solely because of NATS
- AND the api MUST continue serving HTTP CRUD that does not require NATS

### REQ-AST-006: Single image, mode-selected at process boot

**Priority**: P1 (High)

The system MUST ship a **single** container image used by both the api
and worker workloads. The role (api vs worker) MUST be selected at
process boot via configuration (env var or entrypoint flag), not via
separate images. This guarantees parity of dependencies, observability
and security posture across both workloads.

#### Scenario: Same image, different roles

- GIVEN the same image digest deployed to both workloads
- WHEN the api workload boots
- THEN it MUST run only the HTTP role
- AND when the worker workload boots from the same digest
- THEN it MUST run only the durable-consumer role

#### Scenario: Image without mode setting (error)

- GIVEN the image is run with neither an api nor a worker mode set
- WHEN the process starts
- THEN it MUST refuse to start
- AND it MUST exit non-zero with a clear configuration error

### REQ-AST-007: Boot-time dependency failures are surfaced, not silenced

**Priority**: P1 (High)

When boot-time dependency setup fails on the worker (NATS unreachable,
NATS auth failure, DB unreachable), the worker MUST surface the failure
explicitly rather than booting into a half-functional state.

#### Scenario: NATS unreachable at boot

- GIVEN NATS is unreachable when the worker starts
- WHEN the worker tries to establish JetStream connectivity
- THEN it MUST log a structured error with the broker error class
- AND it MUST NOT report `/readyz` 200
- AND it MUST keep retrying with bounded backoff until success or
  external termination

#### Scenario: NATS auth failure at boot (error)

- GIVEN NATS is reachable but credentials are invalid
- WHEN the worker tries to authenticate
- THEN it MUST log the auth error explicitly (without leaking the
  credential)
- AND `/readyz` MUST stay non-200
- AND a `nats_auth_failure` metric MUST be incremented

#### Scenario: DB unreachable at boot

- GIVEN the mirror DB is unreachable when the worker starts
- WHEN the worker tries to open its DB connection
- THEN `/readyz` MUST stay non-200 with the DB gate failing
- AND no durable MUST be bound until the DB gate becomes green

## Non-Functional Requirements

### NFR-AST-001: Process-level isolation between roles

**Category**: Reliability
**Priority**: P1 (High)

A failure in one role's runtime MUST NOT affect the other role.

- **Metric**: an api crash MUST NOT terminate worker pods, and a worker
  crash MUST NOT terminate api pods
- **Target**: 0 cross-role restarts attributable to the other role's
  failures, observed across rolling restart and chaos drills
- **Measurement**: Kubernetes pod restart counts and termination reasons

### NFR-AST-002: Operability parity between roles

**Category**: Observability
**Priority**: P2 (Medium)

Both workloads SHOULD expose the platform's standard observability
endpoints (logs, metrics, health) so that the same operator runbook
applies to either.

- **Metric**: presence of `/healthz`, `/readyz`, and a metrics endpoint
  on both workloads
- **Target**: 100%
- **Measurement**: smoke test against both workloads in non-prod
