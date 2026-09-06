# Workflow-service conformance baseline

Class: descriptive
Summary: Offline audit of critical workflow contracts, observed local checks, source-backed findings and required integration follow-up.

Audit date: 2026-09-05. Scope: workflow-service and relevant shared contracts.
This is a diagnostic report, not approval of the service or a whole-repository
certification. Source and existing tests were not changed.

## Findings

### W1 / P1: Disabling one definition can terminate another definition's runs

`WorkflowsService.terminateRunningExecutions` constructs a prefix from tenant and
the current definition name, then uses `startsWith` against Temporal workflow IDs.
Disabling `orders` can therefore select runs of `orders:priority` in the same tenant.
Renaming a definition after starting a run creates the opposite problem: disabling
the new name misses runs created under the previous name.

Evidence: [prefix and selection](../../services/workflow-service/src/modules/workflows/workflows.service.ts#L519),
[current-name caller](../../services/workflow-service/src/modules/workflows/workflows.service.ts#L600).
The [toggle SPEC](../../manual-loops/workflow-toggle.md) requires termination of
that definition's runs, but its T04 also prescribes name-prefix matching. The
algorithm in that SPEC is defective too; merely enforcing the old task text does
not fix this. Existing tests cover different names, not prefix collisions/renames.

Follow-up: select runs by stable definition identity within the tenant, with
regressions for colon-containing names, rename and unrelated definitions. Keep
historical decisions intact and document the correction in a follow-up SPEC.

### W2 / P1: Canonical subjects can receive a raw, noncanonical payload

`executeServiceBusCall` serializes `args.payload` directly and passes it to
JetStream using the caller's subject. Supplying a canonical `evt.<tenant>...v1`
subject and `{ orderId: "123" }` therefore sends those raw bytes without building
or validating the required envelope. Causal headers alone do not provide the
canonical body fields or `transport.depth`.

Evidence: [serialization](../../services/workflow-service/src/temporal/activities/service-bus.activity.ts#L136)
and [publication](../../services/workflow-service/src/temporal/activities/service-bus.activity.ts#L151).
The [envelope contract](../messaging/envelope.md) and [AGENTS.md](../../AGENTS.md)
apply to canonical bus events. The existing test explicitly expects raw payload
serialization on an arbitrary subject; it does not reject malformed canonical
traffic. No actual broker publication was performed in this audit.

Follow-up: distinguish canonical event publication from authorized noncanonical
transport and reuse shared envelope validation/building. Preserve the explicit
business action's error semantics; do not treat `serviceBusCall` as telemetry.

### W3 / P1: Lifecycle telemetry is awaited on the business execution path

The workflow awaits execution-start telemetry before its actions, action-start
telemetry before dispatch, and completion telemetry before returning. Slow
publisher activities delay the business operation despite the catch blocks.
Publisher configuration allows two attempts with five-second start-to-close timeouts;
without a schedule-to-close limit there is no end-to-end bound from that setting.

Evidence: [action-start await](../../services/workflow-service/src/temporal/workflows.ts#L617),
[workflow-start await](../../services/workflow-service/src/temporal/workflows.ts#L938),
and the publisher proxy in the same file. This contradicts AGENTS.md universal
rule 7's no-delay requirement. It does not mean telemetry rejection necessarily
fails the business result: rejection is caught. The finding is the awaited delay.

Follow-up: explicitly resolve the no-delay contract against Temporal lifecycle
delivery requirements. Do not blindly detach activity promises: workflow closure
and event delivery must remain covered by an agreed design and tests.

### W4 / P2: Lifecycle publishers do not enforce the shared depth ceiling

The lifecycle publisher constructs envelopes locally and assigns the supplied
depth directly. A trigger at depth 4 leads to execution-start depth 5 and action
depth 6. The internal-service ceiling is 5, but this path does not use the shared
builder's ceiling check or required warn-and-root fallback.

Evidence: [action depth assignment](../../services/workflow-service/src/temporal/activities/execution-completed-publisher.activity.ts#L477),
[workflow depth derivation](../../services/workflow-service/src/temporal/workflows.ts#L981),
and [shared builder enforcement](../../packages/shared/src/envelope.utils.ts#L291).
See [envelope depth policy](../messaging/envelope.md) and AGENTS.md rules 7-8.
The helper's enforcement is not proof that callers constructing envelopes manually
are protected. Ordinary shallow-chain examples are not boundary coverage.

Follow-up: shared construction and explicit depth-overflow tests, preserving event
identity/causation requirements and exercising the root fallback with a warning.

### W5 / P2: Completion can be acknowledged before the execution row exists

`executeWorkflow` starts Temporal and then inserts its execution row. The projector
resolves queued handlers even when a batch update affects zero rows. If a fast
completion is processed while insertion is still pending, the consumer can ACK it
without persisting the status; the later row can remain `RUNNING` in list/summary
views until another reconciliation path updates it.

Evidence: [start before insertion](../../services/workflow-service/src/modules/workflows/workflows.service.ts#L444),
[unconditional handler resolution](../../services/workflow-service/src/modules/executions-projector/execution-projector.service.ts#L252),
and [runner acknowledgement](../../packages/database/src/nats-consumer-runner.ts#L496).
This contradicts the projector's documented successful-projection condition at
`enqueue`. It is a source-demonstrated conditional failure path; the timing race
was not reproduced against Temporal or a database. No independent prescriptive
SPEC for that exact ordering was identified.

Follow-up: a controlled insertion/completion ordering regression, then an explicit
strategy for unmatched projection rows. Do not label this live data loss already
observed in the cluster.

### W6 / P2: Equivalent data produces different summaries across storage engines

Mongo's failing-definition count does not exclude soft-deleted definitions;
Postgres joins only non-deleted definitions. Mongo's top-definition ranking also
returns empty name/application strings while Postgres retrieves actual metadata.

Evidence: [Mongo count](../../services/workflow-service/src/modules/workflows/executions.mongo.repository.ts#L169),
[Postgres count](../../services/workflow-service/src/modules/workflows/executions.postgres.repository.ts#L145),
[Mongo ranking](../../services/workflow-service/src/modules/workflows/executions.mongo.repository.ts#L238),
[Postgres ranking](../../services/workflow-service/src/modules/workflows/executions.postgres.repository.ts#L187).
This is an observable implementation parity gap under the supported dual-engine
surface. The exact intended deletion semantics still need to be stated explicitly;
this audit does not select an engine's behavior as the product specification.

Follow-up: establish common summary semantics and run the same fixtures against
both adapters, including deletion and ranked-definition metadata.

## Observed checks

| Check | Observed result |
|:---|:---|
| `bun test test/unit` from workflow-service | Exit 0; 283 pass, 0 fail, 615 assertions, 18 files, 2.66 s |
| Installed `tsc --noEmit --incremental false -p services/workflow-service/tsconfig.json` | Exit 0; no diagnostics |
| KISS guards | Exit 0; DI check scanned zero modified source files |
| Runtime/compiler | Bun 1.3.1; TypeScript 5.9.3 |

Logs: `/tmp/workflow-conformance-20260905/`. No dependencies were installed.
This uses the existing local installation; no clean/frozen reinstall or reproducible
build was demonstrated. Unit setup uses mocked NATS, Temporal and repository
boundaries. No cluster test, replay or actual database/broker behavior was exercised.

The review inspected orchestration/publishers, workflow API/status paths, both
repository families, tenant providers, triggers/projector and relevant shared
contracts. It was not an exhaustive line-by-line audit of every action, dependency
or security boundary. FP compliance is not certified; framework classes alone
were not treated as defects, and no broad FP migration is proposed.

## Positive evidence and remaining integration work

Publishing is routed through activities rather than direct I/O in workflow code;
workflow event IDs use Temporal's `uuid4`. Step-event budget reservations are
synchronous before awaits. The reviewed API/repository paths carry tenant scope,
controller guards and shared types; the projector partitions buffers by tenant.
No cross-tenant exploit was demonstrated by this scoped review.

After local regressions/fixes, a separate live checkpoint should exercise:

- Disable/cancellation with overlapping names and renamed definitions.
- Canonical message consumption, causal depth and broker deduplication.
- Publisher unavailability and actual Temporal scheduling/retry behavior.
- Controlled completion-before-insertion ordering and persisted final status.
- Equivalent fixtures against Postgres and Mongo.

Cancellation delivery, sibling activity behavior after branch failure, tenant
routing, durable acknowledgement and projection timing remain unverified live.
Green unit checks alone do not close these findings. Begin correction with W1's
stable-definition selection; handle messaging contracts and projection/parity in
separate scoped tasks rather than a service-wide rewrite.

Audit process and review evidence:
[workflow-service-conformance-audit](../../manual-loops/architecture/workflow-service-conformance-audit.md).
