#!/usr/bin/env bash
set -euo pipefail

# Auto-load scripts/e2e/.env if present (same convention as scripts/reset/):
# every var below has a script-level ${VAR:-default} fallback, so anything
# set in .env wins over the hardcoded default. See scripts/e2e/README.md.
E2E_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${E2E_SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${E2E_SCRIPT_DIR}/.env"
  set +a
fi

# End-to-end check of the http-channel → workflow trigger → jsFunction chain:
#
#   1. Login as tenant admin (acme by default)
#   2/3/3a/3b. PROVISIONING IS NOW DECLARATIVE (T2,
#      manual-loops/provisioning-manifest-gaps-3.md): a single IntegrationManifest
#      (PUT -> plan -> apply against provisioning-service, via the gateway's
#      T07 proxy routes, same authenticated `api()`/`api_status()` transport
#      every other stage already uses) replaces the old imperative
#      create-http-account / converge-workflow / ensure-agent / converge-
#      agent-workflow calls. The manifest declares:
#        - one `http` channel (per-run unique NAME so channel-service's
#          deterministic `manifest:<name>` externalId is unique too — the
#          NAME embeds this run's nonce, mirroring the old
#          `ACCOUNT_EXTERNAL_PREFIX-${NONCE}` externalId scheme),
#        - the echo agent (FIXED name, reused/no-op across runs — same
#          identity as before),
#        - both e2e workflows (`e2e-http-log`, `e2e-http-agent`), each with a
#          `message_received` trigger whose `config.accountIds` is the ARRAY
#          `channelRef` substitution (`[{ channelRef: <this run's channel
#          name> }]`) pinning it to THIS run's account, plus (workflow 1) a
#          jsFunction that console.logs and a T06 endpointCall probe, and
#          (workflow 2) an agentCall bound to the echo agent via the SCALAR
#          `agentRef` substitution.
#      NONCE-SCOPED WORKFLOW NAMES: unlike the channel, the two e2e workflow
#      NAMES also embed this run's nonce, so every run creates a brand-new
#      workflow pinned from birth to that same run's fresh channel. This
#      started as a workaround for a gap that NO LONGER EXISTS: at migration
#      time `workflowComparable` was existence-only and `workflows-writer.ts`
#      had a no-op `update()` stub, so re-applying the same workflow name
#      could never re-point a stale trigger's `accountIds`. Since
#      manual-loops/provisioning-manifest-gaps-5.md, `workflowComparable`
#      (plan/lib/comparable-fields.ts) is CONTENT-AWARE and
#      `workflows-writer.ts`'s `update()` really does PUT /workflows/:id.
#      The nonce naming is KEPT anyway — it guarantees run isolation for
#      concurrent/leftover runs — but it is now a choice, not a workaround.
#      The channel-account lookup for the appSecret (below) and the
#      workflow enable/disable
#      toggle (stage 6/8) are UNCHANGED by this — they operate on whatever
#      externalId the apply response reports for this run's resources.
#      The endpointCall's `adapterId` and the serviceCall's `serviceId` are
#      SYMBOLIC REFS resolved by name at apply time (`connectorRef` /
#      `serviceRef`, both in provisioning-service's SUBSTITUTION_ALLOWLIST),
#      against `external: true` entries declared below — the fixtures are
#      created out-of-band by fixtures/e2e-prerequisites.yaml. `endpointId`
#      has no ref type and stays runtime-resolved. Historical note: this
#      block previously said the opposite ("stays the RAW pre-existing
#      adapter id ... never wrapped in a ref-object"), which was true only
#      while the fixtures were hand-seeded; it stopped being true once
#      stage 1a started provisioning them declaratively. Old text kept
#      nowhere — corrected in place because it described a mechanism, not a
#      dated finding. Superseded detail:
#      substitute-symbolic-refs.ts only substitutes a value shaped
#      `{ connectorRef: <name> }` (`readRecognizedRefObject`); a plain
#      string at that same allowlisted key is "NOT a recognized single-key
#      ref-object ... legitimately passes
#      through untouched" and falls through to the primitive case, returned
#      byte-identical. So a raw UUID string at an allowlisted key is safe by
#      design, not merely by accident.
#      The manifest apply engine never returns the channel account's
#      `appSecret` (channels-writer.ts intentionally discards everything but
#      `externalId`) — verified live that `GET /api/channels/accounts/:id`
#      (via the gateway) returns the SAME `appSecret` the create response
#      does (channel-service's `AccountsService`/`AccountsController` apply no
#      masking), so it is fetched with one extra authenticated GET right
#      after apply, using the channel's externalId from the apply response.
#      An EXIT trap still tears the manifest-declared channel/workflows/agent
#      down afterwards (skipped when E2E_KEEP=1) — see `cleanup_e2e_resources`.
#      Agent PUBLISH is a runtime activation step, not a declarative manifest
#      property (the manifest schema has no such field), so it stays an
#      explicit imperative POST after apply, exactly like the workflow
#      enable/disable toggle (stage 6/8) stays imperative — both are runtime
#      state, not manifest-declared shape.
#   4. POST a webhook message carrying a unique nonce
#   5. Poll the workflow executions API until an execution for this run
#      completes, then assert the nonce appeared in workflow-worker logs
#   6. Disable the workflow via PATCH /workflows/:id/status and assert the
#      response reports a `terminated` count
#   7. POST a webhook message with a fresh nonce; wait for
#      workflow-service-worker's trigger-consumer to log its "skipped
#      disabled workflow" line (positive confirmation the message arrived
#      and was refused), then assert via the executions API that no new
#      execution was recorded
#   8. Re-enable the workflow, POST another fresh nonce, and assert the
#      execution completes (reuses the stage_verify_execution polling logic)
#   9. Capture the correlation_id of the happy-path run (stage 4/5's nonce)
#      via the log-workflow's execution detail (`result.causal.correlation_id`)
#  10. GET /api/tracking/chains/:correlationId via the gateway and assert the
#      chain has >=5 events, a numeric summary.orphan_count, at least one span
#      with duration_ms > 0, a chain `execution_started` event, AND a
#      workflow-execution span specifically (entity_id == the happy-path
#      executionId captured in stage 9, kind_prefix == "execution") with
#      duration_ms > 0 — every workflow run now emits `execution_started`
#      (T02, manual-loops/workflow-step-events.md), so the workflow's own
#      execution_started/execution_completed pair is asserted directly and no
#      longer needs the agent-path's span as a stand-in. The SAME manifest
#      apply also declares the echo agent + a second workflow with an
#      `agentCall` action sharing the same http trigger — kept as separate,
#      still-valid coverage for the agent-execution span family, not removed.
#  10b. Verify the T03 step-event contract on the same chain (T05,
#      manual-loops/workflow-step-events.md): >=2 `action_started` AND >=2
#      `action_completed` events (one jsFunction pair from e2e-http-log, one
#      agentCall pair from e2e-http-agent, stages 3/3b), `actionIndex`
#      present and numeric (fetched via the payload endpoint — the chain LIST
#      response excludes the envelope, so `action_index` is not a queryable
#      column), and the event-count multiplier vs the pre-step-events
#      baseline of 3 events/run is logged and asserted to stay under the
#      100-step volume cap.
#  11. GET /api/tracking/chains/:correlationId/events/:eventId/payload for
#      the chain's webhook_received (ingress) event and assert HTTP 200 with
#      the payload containing the happy-path nonce, then repeat for a
#      fabricated unknown event id on the same correlation and assert 404 —
#      proves durable payload capture end-to-end.
#  12. GET /api/tracking/runs/:workflowId/:runId (T07,
#      manual-loops/run-view.md) for the happy-path run and assert HTTP 200,
#      summary.status == "completed", summary.steps_ok >= 1, `cast` contains
#      a channel-kind entry for the http channel (`tech` "http-generic" per
#      TAXONOMY.md's Q5 rename), and at least one step span with
#      duration_ms > 0. The (workflowId, runId) pair is the real Temporal
#      ids — sourced from the SAME executions-list response stage 9 already
#      polls by nonce (`GET /workflows/:id/executions?pageSize=100`), whose
#      items carry `temporalWorkflowId`/`temporalRunId`
#      (IWorkflowExecutionListItem, workflows.service.ts's mapExecutionRow) —
#      verified by reading the workflow-service execution list/DTO source;
#      the single-execution detail endpoint used later in stage 9
#      (`GET /workflows/:id/executions/:executionId`) only exposes
#      `temporalWorkflowId`, not `temporalRunId` (IExecutionStatusResult), so
#      it could not have served this purpose alone. workflowId is
#      colon-bearing (`acme:e2e-http-log:sha256:...:id`) and is
#      percent-encoded before being placed in the URL path, matching the
#      gateway's `parseRunPathSegments` contract (T02).
#  13. (T06, manual-loops/connector-trace-linking.md) Stage 3 now also
#      provisions a second action on '${WORKFLOW_NAME}' — an `endpointCall`
#      hitting the pokeapi adapter — since neither e2e workflow previously
#      exercised `endpointCall` at all (T02 finding: no endpoint_call event
#      was ever produced by this suite). After the happy-path run, a SQL
#      query against `tracking.tracked_events` asserts the resulting
#      `endpoint_call_completed` row shares the happy-path run's
#      correlation_id (proves connector-runtime inherits workflow causal
#      correlation end-to-end, not just in unit tests).
#  14. GET /api/tracking/events?type=connector.endpoint_call.completed.v1
#      &resource=adapter/<adapterId>&limit=20 via the gateway and assert the
#      response contains an event whose correlation_id matches the
#      happy-path run — proves the gateway->ingester events-by-type/resource
#      read path (the connector "Recent calls" feed) also carries the
#      correlation through.
#      Around stages 13/14 the script also logs (not asserts) the
#      before/after count of endpoint_call_completed rows that are
#      "orphaned" (no other tracked_events row shares their correlation_id)
#      vs those that have siblings — evidence-at-volume for the correlation
#      fix, per T06.
#  14b. (T04, manual-loops/connectors/endpoint-scoped-recent-calls.md) Stage 3
#      also provisions a FOURTH action on '${WORKFLOW_NAME}' —
#      'probeEndpointScoped', an `endpointCall` carrying BOTH `adapterId`
#      and a real `endpointId` resolved at run time (stage 1b). That arg
#      pair is what selects connector-runtime's `execute-with-adapter-
#      endpoint` branch, the only one that publishes a NON-NULL payload
#      `endpointId` (`execute-with-adapter-base`, which stage 3's original
#      'probeEndpoint' takes, publishes `endpointId: null` — verified in
#      execute-with-adapter-base.ts, and the reason this stage could not
#      just reuse 'probeEndpoint'). The endpoint id is NEVER hardcoded: it
#      is discovered via `GET /api/connectors/${ENDPOINT_ADAPTER_ID}` and
#      jq-selected from the adapter's `endpoints[]` (see README.md's
#      `E2E_ENDPOINT_ADAPTER_ID` stale-default caveat — endpoint ids are
#      regenerated by every re-seed, so a literal would rot the same way).
#      The stage then GETs
#      /api/tracking/events?type=connector.endpoint_call.completed.v1
#      &resource=adapter/<adapterId>&endpointId=<endpointId>&limit=20 and
#      asserts: >=1 row returned, EVERY returned row's `payload_endpoint_id`
#      equals the requested endpoint id, at least one of them carries the
#      happy-path correlation_id, and a fabricated nonexistent `endpointId`
#      returns HTTP 200 with an EMPTY `events` array (the events route is a
#      filtered LIST, not a lookup — handle-events-request.ts never 404s on
#      an unmatched filter).
#  15. (T12, manual-loops/connectors/connection-call-inspector.md) Stage 3
#      now also provisions a THIRD action on '${WORKFLOW_NAME}' — a
#      `serviceCall` hitting the pre-existing 'sample-echo' hosted service
#      (T01's documented gap: serviceCall previously emitted NO
#      endpoint_call_completed event, and this suite never exercised it).
#      After the happy-path run, the same direct SQL query pattern as
#      stage 13 asserts the resulting `endpoint_call_completed` row, with
#      resource `service/sample-echo`, shares the happy-path run's
#      correlation_id.
#  16. GET /api/tracking/events?type=connector.endpoint_call.completed.v1
#      &resource=service/sample-echo&limit=20 via the gateway (mirrors
#      stage 14 for the serviceCall resource prefix) and assert the
#      response contains an event whose correlation_id matches the
#      happy-path run, capturing its event_id.
#  17. GET /api/tracking/chains/:correlationId/events/:eventId/payload for
#      the serviceCall event from stage 16, as the admin user, and assert
#      HTTP 200 with the payload containing the happy-path nonce — the
#      'probeService' action's `args.data.nonce` embeds
#      `{{request.text}}` so the captured requestBody round-trips it.
#      MCP and standalone-LLM emission paths (T03/T04 of the same SPEC) are
#      NOT covered by this e2e: no MCP server or standalone-LLM job fixture
#      exists in the dev cluster today, so those two paths stay covered by
#      service-level unit tests only (out of scope for T12 to add).
#
# Exit code 0 = full chain verified; 1 = any stage failed. The workflow is
# always left ENABLED on exit (trap), even on failure — moot for a future
# run (each run's workflow is a fresh manifest-applied resource, see the
# provisioning section above), but still correct for anyone inspecting a
# kept run (E2E_KEEP=1) or a run this trap is unwinding mid-flight.
#
# Designed to be the executable foundation for future e2e suites: each stage
# is a function with a single assertion point.

NAMESPACE="${E2E_NAMESPACE:-platform-services-dev}"
API_URL="${E2E_API_URL:-http://api-gateway.platform-services-dev.dev.local}"
HOST_HEADER="${E2E_HOST_HEADER:-api-gateway.platform-services-dev.dev.local}"
TENANT="${E2E_TENANT:-acme}"
EMAIL="${E2E_EMAIL:-yclawd@demo.io}"
PASSWORD="${E2E_PASSWORD:-admin123}"
# T2 (manual-loops/provisioning-manifest-gaps-3.md): provisioning is now one
# IntegrationManifest (put+plan+apply against provisioning-service). The
# manifest's own name stays fixed across runs (its revision number just
# increments); the CHANNEL name embeds this run's nonce so channel-service's
# deterministic `manifest:<name>` externalId can never collide on the
# (channel, external_id) unique constraint (mirrors the old
# `ACCOUNT_EXTERNAL_PREFIX-${NONCE}` externalId scheme). `ACCOUNT_EXTERNAL_PREFIX`
# is kept as the deterministic PREFIX of that derived externalId (see
# channels-writer.ts) so `cleanup_e2e_resources`' stale-account sweep still
# matches by prefix.
MANIFEST_NAME="e2e-http-workflow"
ACCOUNT_EXTERNAL_PREFIX="manifest:e2e-http-workflow"
CHANNEL_NAME_PREFIX="e2e-http-workflow"
# Both e2e workflow NAMES embed this run's nonce — a fresh manifest-created
# workflow every run, pinned from birth to that same run's channel — so
# `cleanup_e2e_resources` sweeps workflows by NAME PREFIX (like the channel
# account) instead of a fixed-name exact match. This started as a workaround
# for `workflowComparable` being existence-only and `workflows-writer.ts`'s
# `update()` being a no-op stub; both were since fixed (see the header
# comment's NONCE-SCOPED WORKFLOW NAMES note), and the nonce naming is kept
# for run isolation.
WORKFLOW_NAME_PREFIX="e2e-http-log"
# The echo agent + agent-calling workflow sharing the same http trigger, so
# the happy-path run also produces a real runtime execution (agent-ai-service)
# whose span has duration_ms > 0 (see stage 10). The agent's identity stays
# FIXED across runs (reused/no-op'd by the manifest apply engine, exactly
# like before); only the agent-calling WORKFLOW'S name embeds the nonce, for
# the same reason as e2e-http-log above.
AGENT_NAME="e2e-http-agent-echo"
AGENT_WORKFLOW_NAME_PREFIX="e2e-http-agentflow"
# COMPOSITION COVERAGE: a third workflow that chains jsFunction -> serviceCall
# -> conditional, with an agentCall NESTED INSIDE the matching branch. The
# other two workflows each exercise activities in isolation (workflow 1 runs
# jsFunction/endpointCall/serviceCall as a flat list; workflow 2 runs a lone
# agentCall) — neither proves the activities COMPOSE, and before this workflow
# existed `conditional` had zero e2e coverage of any kind. Kept as a SEPARATE
# workflow rather than by extending workflow 1 so the existing stages' exact
# counts and their failure localization stay intact: if only this workflow
# goes red the defect is in composition, if workflow 1 goes red too it is in
# the primitive. Same nonce-suffixed naming as the other two.
COMPOSITE_WORKFLOW_NAME_PREFIX="e2e-http-composite"
# The literal a branch action logs if the DELIBERATELY-FALSE first branch ever
# executes. Asserted ABSENT from the worker log — see stage_verify_conditional.
COMPOSITE_WRONG_BRANCH_MARKER="E2E-COMPOSITE-WRONG-BRANCH"
# The two branch labels, in definition order. Branch 1's condition is written
# to never match, so a correct engine must fall through to branch 2 — that is
# what makes this a real ordering test rather than an always-true no-op.
COMPOSITE_BRANCH_NEVER="never-matches"
COMPOSITE_BRANCH_MATCH="matches-nonce"
# EGRESS COVERAGE: the composite workflow's last action is a `channelSend`
# through the `e2e-tests` sink channel. That channel exists precisely so this
# assertion can be made: `EgressService` publishes `sent.v1` only inside
# `if (result.success)`, and no other channel can reach that branch here —
# `http` fails by design, and telegram needs live credentials. Everything after
# the provider returns is the same code the real channels run, so this covers
# the actual egress publish path.
EGRESS_CHANNEL_NAME_PREFIX="e2e-egress-sink"
# Arbitrary recipient: the sink discards the message, so `to` only has to be a
# non-empty string the action validator accepts.
EGRESS_RECIPIENT="e2e-sink-recipient"
# FAN-OUT COVERAGE: `branch` runs every one of its branches CONCURRENTLY
# (`Promise.all` in workflows.ts) on cloned contexts, then merges their results
# back — semantically the opposite of `conditional`, which picks exactly one.
# Each branch's actions carry the branch label on their step events
# (`branch` on the action_started/completed payload), which is what makes
# "both branches actually ran" assertable rather than inferred.
BRANCH_ALPHA="probe-alpha"
BRANCH_BETA="probe-beta"
# The `serviceBusCall` lives INSIDE the beta branch: one addition covers the
# bus publish AND proves actions nest inside a fan-out. Its subject is
# deliberately NOT under `evt.<tenant>.>` — that pattern is bound to the
# tenant's INGRESS stream, and this activity publishes a RAW payload, not an
# envelope, so routing it there would feed the tracking ingester something it
# cannot parse. An unbound subject makes `executeServiceBusCall` fall back to
# a core-NATS publish (its documented ad-hoc fan-out path) and disturbs
# nothing.
BUS_PROBE_SUBJECT_PREFIX="e2e.bus-probe"
# T06 (manual-loops/connector-trace-linking.md): the pokeapi adapter — a
# harmless GET — used by stage 3's 'probeEndpoint' endpointCall action so the
# e2e suite finally exercises the endpointCall activity (T02 finding:
# previously NO endpoint_call event was ever produced by this script).
# PREREQUISITES-AS-MANIFEST (replaces the old hardcoded-id/re-seed-by-hand
# approach): stage_ensure_prerequisites applies a LibraryManifest declaring
# this connector and resolves its id BY NAME at run time — never stale after
# a cluster reset, no manual re-seed, no id to keep in .env. Set
# E2E_ENDPOINT_ADAPTER_ID explicitly to skip that and pin a specific
# pre-existing adapter instead (advanced/override use only).
ENDPOINT_ADAPTER_ID="${E2E_ENDPOINT_ADAPTER_ID:-}"
# T04 (manual-loops/connectors/endpoint-scoped-recent-calls.md): the ENDPOINT
# (not adapter) this run's 'probeEndpointScoped' action targets, so the
# published endpoint_call_completed payload carries a NON-NULL `endpointId`
# and stage 14b's `endpointId=` filter has something to match. Deliberately
# NOT a hardcoded default: adapter endpoint ids are server-generated and are
# regenerated on every re-seed of the pokeapi connector (README.md's
# `E2E_ENDPOINT_ADAPTER_ID` stale-default caveat applies doubly here), so
# stage_resolve_endpoint_id discovers it at run time from
# `GET /api/connectors/${ENDPOINT_ADAPTER_ID}`. E2E_ENDPOINT_ID may still be
# set in .env to pin a specific endpoint; when set, the resolve stage
# validates it exists on the adapter rather than trusting it blindly.
ENDPOINT_ID="${E2E_ENDPOINT_ID:-}"
# The endpoint the resolve stage PREFERS when E2E_ENDPOINT_ID is unset: the
# pokeapi 'GET /api/v2/pokemon/ditto' endpoint — the same harmless call
# stage 3's original 'probeEndpoint' already makes over the adapter-base
# branch. If the adapter has no endpoint with this method/path, the resolve
# stage falls back to the adapter's FIRST endpoint (logged), and FAILS loudly
# if the adapter exposes none at all.
ENDPOINT_PREFERRED_METHOD="${E2E_ENDPOINT_PREFERRED_METHOD:-GET}"
ENDPOINT_PREFERRED_PATH="${E2E_ENDPOINT_PREFERRED_PATH:-/api/v2/pokemon/ditto}"
# The resolved endpoint's own `path`, captured alongside ENDPOINT_ID purely so
# the manifest's 'probeEndpointScoped' action reads truthfully. The value is
# NOT used to build the request: in the adapter+endpoint branch the endpoint
# definition supplies method/path and `args.url` is ignored
# (execute-with-adapter-endpoint.ts) — but the workflow-action validator
# still requires `args.url` to be a string (workflow-action.validator.ts's
# isEndpointArgs), so something has to go there.
ENDPOINT_RESOLVED_PATH=""
# T12 (manual-loops/connectors/connection-call-inspector.md): the 'sample-echo'
# hosted service — a harmless echo service — used by stage 3's 'probeService'
# serviceCall action so the e2e suite finally exercises the serviceCall
# activity's per-call capture (T01's documented gap: serviceCall previously
# emitted NO endpoint_call_completed event at all, and this suite never
# exercised serviceCall). Same PREREQUISITES-AS-MANIFEST convention as
# ENDPOINT_ADAPTER_ID above: stage_ensure_prerequisites's LibraryManifest also
# declares this `services[]` entry and resolves its id BY NAME at run time —
# `args.serviceId` stays a plain string, never a `{ serviceRef: ... }`
# ref-object, because this manifest is applied by THIS script's own
# prerequisites step, not the e2e workflow manifest below (see the header
# comment's substitute-symbolic-refs.ts walker note — a raw string at that
# allowlisted key passes through byte-identical, same as
# `probeEndpoint.args.adapterId`). Set E2E_SERVICE_CALL_SERVICE_ID explicitly
# to skip provisioning and pin a specific pre-existing service instead.
SERVICE_CALL_SERVICE_ID="${E2E_SERVICE_CALL_SERVICE_ID:-}"
SERVICE_CALL_SERVICE_SLUG="${E2E_SERVICE_CALL_SERVICE_SLUG:-sample-echo}"
PREREQUISITES_MANIFEST_NAME="e2e-prerequisites"
# The YAML this suite's prerequisites are authored in — same format as every
# sample's manifest.yaml, converted to JSON at call time by
# e2e_prerequisites_manifest_body. Resolved from the script's own directory so
# the suite runs from any cwd.
PREREQUISITES_MANIFEST_FILE="${E2E_SCRIPT_DIR}/fixtures/e2e-prerequisites.yaml"
# Namespace/pod for the direct SQL assertions in stages 13/14 — same
# Postgres instance the tracking-ingester-service writes tracking.tracked_events
# to. There is no ingester-side SQL helper endpoint, so this queries Postgres
# directly via kubectl exec, same as the log-grep stages query Kubernetes logs
# directly.
TRACKING_PG_NAMESPACE="${E2E_TRACKING_PG_NAMESPACE:-support-services-dev}"
TRACKING_PG_POD="${E2E_TRACKING_PG_POD:-postgres-0}"
TRACKING_PG_USER="${E2E_TRACKING_PG_USER:-yoizen}"
TRACKING_PG_DB="${E2E_TRACKING_PG_DB:-yoizen}"
# 120s (was 60s): the workflow-execution wait must accommodate re-enable
# propagation and the fuller event pipeline — every run now also publishes
# the step-event stream (execution_started + action/condition events, x2 for
# the shared-trigger agent workflow), so a re-enabled run occasionally lands
# just past a 60s bound even though it runs correctly. Matches CHAIN_TIMEOUT_S.
POLL_TIMEOUT_S="${E2E_POLL_TIMEOUT_S:-120}"
# Bound for the disabled-workflow stage's *positive* wait (see
# stage_verify_no_execution): it polls workflow-service-worker logs for the
# trigger-consumer's "Skipped trigger for disabled workflow" warn line, i.e.
# the same NATS ingest -> trigger-match hop the happy path waits on before
# handing off to Temporal. There is no reason that hop would be faster just
# because the outcome is a skip rather than a start, so this reuses
# POLL_TIMEOUT_S rather than a separate, shorter, empirically-unjustified
# constant.
DISABLED_CHECK_TIMEOUT_S="${E2E_DISABLED_CHECK_TIMEOUT_S:-$POLL_TIMEOUT_S}"
# Stage 10's own poll bound, independent of POLL_TIMEOUT_S: the chain read
# is a Postgres query behind the ingester, not a Temporal/NATS hop, but it
# still races the agentCall runtime execution (agent-ai-service via
# ai-agent-gateway), which can be slower than the plain jsFunction path.
# Also reused by stage 12 (run endpoint), which is the same class of
# ingester Postgres read, scoped to one run instead of the whole chain.
CHAIN_TIMEOUT_S="${E2E_CHAIN_TIMEOUT_S:-120}"

# macOS mDNS resolves *.dev.local in ~5s even with /etc/hosts entries;
# --resolve skips DNS. Override/disable via E2E_RESOLVE_IP.
E2E_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}"
API_SCHEME="${API_URL%%://*}"
API_HOST_PORT="${API_URL#*://}"
API_HOST_PORT="${API_HOST_PORT%%/*}"
if [[ "$API_HOST_PORT" == *:* ]]; then
  API_PORT="${API_HOST_PORT##*:}"
elif [[ "$API_SCHEME" == "https" ]]; then
  API_PORT=443
else
  API_PORT=80
fi
# Built once as an array; the length check at each call site below skips
# appending the --resolve flag entirely when E2E_RESOLVE_IP is unset/empty.
RESOLVE_ARGS=()
if [[ -n "$E2E_RESOLVE_IP" ]]; then
  RESOLVE_ARGS=(--resolve "${HOST_HEADER}:${API_PORT}:${E2E_RESOLVE_IP}")
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

NONCE="e2e-$(date +%s)-$RANDOM"
NONCE_DISABLED="e2e-disabled-$(date +%s)-$RANDOM"
NONCE_REENABLED="e2e-reenabled-$(date +%s)-$RANDOM"
# T2: per-run manifest resource names — see the provisioning section of the
# header comment for why the channel AND both workflow names embed NONCE
# (the agent's name stays the fixed AGENT_NAME above, reused across runs).
CHANNEL_NAME="${CHANNEL_NAME_PREFIX}-${NONCE}"
WORKFLOW_NAME="${WORKFLOW_NAME_PREFIX}-${NONCE}"
AGENT_WORKFLOW_NAME="${AGENT_WORKFLOW_NAME_PREFIX}-${NONCE}"
COMPOSITE_WORKFLOW_NAME="${COMPOSITE_WORKFLOW_NAME_PREFIX}-${NONCE}"
EGRESS_CHANNEL_NAME="${EGRESS_CHANNEL_NAME_PREFIX}-${NONCE}"
BUS_PROBE_SUBJECT="${BUS_PROBE_SUBJECT_PREFIX}.${NONCE}"
TOKEN=""
APP_SECRET=""
# T08 (manual-loops/connector-trace-linking.md): the http account created by
# the manifest apply each run. Its id is (a) the value the webhook envelope
# carries as `accountId`, which the account-scoped triggers filter on, and
# (b) captured so the EXIT cleanup can delete exactly this run's account.
# Was previously discarded — only appSecret was kept.
ACCOUNT_ID=""
WORKFLOW_ID=""
AGENT_ID=""
AGENT_WORKFLOW_ID=""
COMPOSITE_WORKFLOW_ID=""
EGRESS_ACCOUNT_ID=""
CORRELATION_ID=""
# The happy-path (nonce=$NONCE) execution id, captured by
# stage_capture_correlation_id. Used by stage_verify_chain (stage 10) to
# find the workflow-execution span specifically (entity_id == this id),
# rather than relying on ANY nonzero-duration span in the chain (see T02,
# manual-loops/workflow-step-events.md).
HAPPY_PATH_EXECUTION_ID=""
# The happy-path run's real Temporal identifiers, captured alongside
# HAPPY_PATH_EXECUTION_ID by stage_capture_correlation_id (stage 9) from the
# SAME executions-list response (IWorkflowExecutionListItem carries both).
# Used by stage_verify_run (stage 12) to call the ingester's run endpoint
# (T01/T02, manual-loops/run-view.md).
HAPPY_PATH_WORKFLOW_ID=""
HAPPY_PATH_RUN_ID=""
# The last successful chain response body captured by stage_verify_chain
# (stage 10). stage_verify_step_events (stage 10b) reuses it instead of
# re-polling the chain endpoint — stage 10 already waited for the chain to
# stabilize (events_ok/orphan_ok/nonzero_span_ok/etc. all true), so a second
# independent poll would just repeat that wait for no benefit.
CHAIN_BODY=""
# Set to 1 once the workflow has been disabled and not yet confirmed
# re-enabled; the EXIT trap uses this to guarantee the workflow is never
# left disabled, regardless of which stage fails.
WORKFLOW_DISABLED=0
# T12: event_id of the happy-path serviceCall's endpoint_call_completed
# event, captured by stage_verify_service_call_events_gateway (stage 16) and
# consumed by stage_verify_service_call_payload (stage 17).
SERVICE_CALL_EVENT_ID=""

cleanup_e2e_resources() {
  # T08 (manual-loops/connector-trace-linking.md): best-effort end-of-run
  # teardown of this run's e2e footprint so the greedy shared-trigger
  # definitions never linger between runs (before account-scoped triggers they
  # fanned out onto every http message; even scoped, a leftover definition is
  # noise). Deletes: both e2e workflow definitions, this run's http account
  # (plus any e2e-prefixed stragglers), and the shared echo agent. Every call
  # is `|| true` — cleanup NEVER changes the run's exit status. `E2E_KEEP=1`
  # skips it entirely (logged), leaving this run's manifest-applied
  # resources in place for inspection; a future run's own per-run-unique
  # channel/workflow names never collide with them regardless (T2), and this
  # SAME sweep reclaims them (by prefix) the next time it runs uncached.
  if [[ "${E2E_KEEP:-0}" == "1" ]]; then
    warn "Cleanup: E2E_KEEP=1 set — leaving e2e workflows/account/echo agent in place"
    return 0
  fi
  log "Cleanup: removing this run's e2e workflows, http account, and echo agent (best-effort)"
  local id
  # Workflow definitions — DELETE /api/workflows/:id (same endpoint apply's
  # own workflow-writer POST uses). T2: matched by NAME PREFIX, not exact
  # name — every run's manifest-applied workflows carry a per-run nonce
  # suffix (see the header comment's NONCE-SCOPED WORKFLOW NAMES note), so
  # this also reclaims any e2e-prefixed stragglers left by a crashed prior
  # run, same as the http-account sweep below.
  local wf_ids
  wf_ids="$(api GET /api/workflows 2>/dev/null \
    | jq -r ".[] | select(.name | startswith(\"${WORKFLOW_NAME_PREFIX}\") or startswith(\"${AGENT_WORKFLOW_NAME_PREFIX}\") or startswith(\"${COMPOSITE_WORKFLOW_NAME_PREFIX}\")) | .id" 2>/dev/null || true)"
  for id in $wf_ids; do
    cleanup_delete "workflow" "/api/workflows/${id}" "${id}"
  done
  # Http account(s) — DELETE /api/channels/accounts/:id. Covers this run's
  # manifest-applied account and any e2e-prefixed leftovers from crashed runs.
  local acc_ids
  acc_ids="$(api GET "/api/channels/accounts?channel=http" 2>/dev/null \
    | jq -r ".[] | select(.externalId | startswith(\"${ACCOUNT_EXTERNAL_PREFIX}\")) | .id" 2>/dev/null || true)"
  for id in $acc_ids; do
    cleanup_delete "http account" "/api/channels/accounts/${id}" "${id}"
  done
  # The e2e-tests sink account lives on its own channel, so the http query
  # above cannot see it. Matched by NAME prefix (not externalId) because the
  # manifest engine derives the sink account's externalId itself.
  local sink_ids
  sink_ids="$(api GET "/api/channels/accounts?channel=e2e-tests" 2>/dev/null \
    | jq -r ".[] | select(.name | startswith(\"${EGRESS_CHANNEL_NAME_PREFIX}\")) | .id" 2>/dev/null || true)"
  for id in $sink_ids; do
    cleanup_delete "e2e-tests sink account" "/api/channels/accounts/${id}" "${id}"
  done
  # Echo agent — DELETE /api/admin/agents/:id (gateway admin-agents route).
  local agent_ids
  agent_ids="$(api GET /api/admin/agents 2>/dev/null \
    | jq -r ".agents[]? | select(.name == \"${AGENT_NAME}\") | .id" 2>/dev/null || true)"
  for id in $agent_ids; do
    cleanup_delete "echo agent" "/api/admin/agents/${id}" "${id}"
  done
  log "Cleanup: done"
}

cleanup_delete() {
  # cleanup_delete <label> <path> <id>
  # Best-effort DELETE that reports the REAL HTTP status. `api DELETE` uses
  # `curl -s` with no `-f`, so curl exits 0 on ANY completed response
  # (including 4xx/5xx) — an earlier version's `if api DELETE ...` therefore
  # logged false "deleted" successes for calls that actually 404'd/errored.
  # This checks the status code via api_status and treats only 2xx (and 404,
  # already-gone) as success, warning with the body otherwise. Never returns
  # non-zero: cleanup must never flip the run's exit status.
  local label="$1" path="$2" id="$3"
  local combined status body
  # NOTE the '{}' body: api()/api_status() always set
  # Content-Type: application/json, and a DELETE with an EMPTY body then 400s
  # ("Body cannot be empty ...") at the gateway — the same gotcha the
  # agent-publish call documents. Sending '{}' satisfies the content-type
  # check; the gateway ignores the body on DELETE (verified live: 204).
  combined="$(api_status DELETE "$path" '{}' 2>/dev/null || true)"
  status="$(api_status_code "$combined")"
  body="$(api_status_body "$combined")"
  case "$status" in
    2??|404)
      log "Cleanup: deleted ${label} ${id} (status ${status})"
      ;;
    *)
      warn "Cleanup: failed to delete ${label} ${id} (status ${status}: ${body}) — non-fatal"
      ;;
  esac
}

on_exit() {
  # Single merged EXIT handler. Two responsibilities, in order:
  #   1. (pre-existing) never leave the workflow DISABLED — re-enable it if a
  #      failure struck between stage 6 (disable) and stage 8 (re-enable).
  #   2. (T08) best-effort teardown of this run's e2e resources.
  # Both run before propagating the original exit code. Under E2E_KEEP=1 the
  # re-enable still runs (so a kept definition is left usable) but the teardown
  # is skipped inside cleanup_e2e_resources.
  local exit_code=$?
  if [[ "$WORKFLOW_DISABLED" -eq 1 && -n "$WORKFLOW_ID" ]]; then
    warn "Cleanup: re-enabling workflow ${WORKFLOW_ID} before exit"
    if api PATCH "/api/workflows/${WORKFLOW_ID}/status" '{"status":"enabled"}' >/dev/null 2>&1; then
      log "Cleanup: workflow ${WORKFLOW_ID} re-enabled"
    else
      err "Cleanup: FAILED to re-enable workflow ${WORKFLOW_ID} — manual intervention required"
    fi
  fi
  cleanup_e2e_resources
  exit "$exit_code"
}
trap on_exit EXIT

api() {
  # api <method> <path> [json-body]
  # --connect-timeout/--max-time bound a hanging gateway connection (was a live 10+min stall).
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

api_status() {
  # api_status <method> <path> [json-body]
  # Same request as api(), but callers need the HTTP status alongside the
  # body (api() hides it). Emits the body followed by a final line holding
  # only the status code; api_status_body/api_status_code split the two via
  # plain bash parameter expansion (no sed/grep — keeps this shellcheck -x
  # clean and avoids embedded-newline edge cases in the response body).
  # Same --connect-timeout/--max-time hang guard as api().
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -w '\n%{http_code}' -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

api_status_body() {
  # api_status_body <combined-output> — everything before the final line.
  local combined="$1"
  printf '%s' "${combined%$'\n'*}"
}

api_status_code() {
  # api_status_code <combined-output> — the final line (status code).
  local combined="$1"
  printf '%s' "${combined##*$'\n'}"
}

e2e_prerequisites_manifest_body() {
  # PREREQUISITES-AS-MANIFEST: emits the JSON body for the LibraryManifest
  # that provisions this suite's two standing fixtures (the pokeapi connector
  # and the 'sample-echo' hosted service).
  #
  # The manifest is AUTHORED AS YAML (fixtures/e2e-prerequisites.yaml — see
  # that file's header for what each resource is for and why it is a subset of
  # the samples that own them) and converted here, so the checked-in artifact
  # is the same shape every sample and demo uses and can be applied by hand
  # for debugging:
  #     yoizen manifests apply -f scripts/e2e/fixtures/e2e-prerequisites.yaml
  # The conversion keeps this script's no-new-dependency property: it still
  # talks plain HTTP through api()/api_status() rather than shelling out to
  # the `yoizen` CLI. `yq` is already a hard dependency of the repo's checks
  # (scripts/checks/doc-code-guards.sh requires mikefarah v4+), and `-o=json`
  # preserves numeric types, which matters — `port`/`minScale`/`maxScale`/
  # `concurrencyTarget` must reach the schema as numbers, not strings.
  if ! command -v yq >/dev/null 2>&1; then
    err "yq (mikefarah v4+) is required to read ${PREREQUISITES_MANIFEST_FILE}"
    return 1
  fi
  if [[ ! -f "$PREREQUISITES_MANIFEST_FILE" ]]; then
    err "Prerequisites manifest not found: ${PREREQUISITES_MANIFEST_FILE}"
    return 1
  fi
  yq -o=json '.' "$PREREQUISITES_MANIFEST_FILE"
}

stage_ensure_prerequisites() {
  # Applies the prerequisites manifest, then resolves ENDPOINT_ADAPTER_ID and
  # SERVICE_CALL_SERVICE_ID BY NAME — skipped entirely for whichever id the
  # caller already pinned via E2E_ENDPOINT_ADAPTER_ID/E2E_SERVICE_CALL_SERVICE_ID.
  if [[ -n "$ENDPOINT_ADAPTER_ID" && -n "$SERVICE_CALL_SERVICE_ID" ]]; then
    log "Stage 1a: both prerequisite ids pinned via env — skipping manifest apply"
    return 0
  fi

  log "Stage 1a: PUT+plan+apply '${PREREQUISITES_MANIFEST_NAME}' (pokeapi connector + sample-echo service)"
  local body put_resp put_revision
  body="$(e2e_prerequisites_manifest_body)"
  put_resp="$(api PUT "/api/provisioning/manifests/${PREREQUISITES_MANIFEST_NAME}" "$body")"
  put_revision="$(echo "$put_resp" | jq -r '.revision // empty')"
  if [[ -z "$put_revision" ]]; then
    err "Prerequisites manifest PUT did not return a revision: $put_resp"
    return 1
  fi

  api POST "/api/provisioning/manifests/${PREREQUISITES_MANIFEST_NAME}/plan" '{}' >/dev/null

  local apply_resp applied_count
  apply_resp="$(api POST "/api/provisioning/manifests/${PREREQUISITES_MANIFEST_NAME}/apply" '{}')"
  applied_count="$(echo "$apply_resp" | jq -r '.appliedCount // empty')"
  if [[ -z "$applied_count" ]]; then
    err "Prerequisites manifest apply failed or returned no appliedCount: $apply_resp"
    return 1
  fi
  log "Prerequisites manifest applied: appliedCount=${applied_count} noopCount=$(echo "$apply_resp" | jq -r '.noopCount // 0')"

  if [[ -z "$ENDPOINT_ADAPTER_ID" ]]; then
    local connector_resp
    connector_resp="$(api GET "/api/connectors?name=pokeapi")"
    ENDPOINT_ADAPTER_ID="$(echo "$connector_resp" | jq -r '.[0].id // empty')"
    if [[ -z "$ENDPOINT_ADAPTER_ID" ]]; then
      err "Could not resolve pokeapi connector id after apply: $connector_resp"
      return 1
    fi
    log "Resolved pokeapi adapter id: ${ENDPOINT_ADAPTER_ID}"
  fi

  if [[ -z "$SERVICE_CALL_SERVICE_ID" ]]; then
    local service_resp
    service_resp="$(api GET "/api/registry/services?name=${SERVICE_CALL_SERVICE_SLUG}")"
    SERVICE_CALL_SERVICE_ID="$(echo "$service_resp" | jq -r '.[0].id // empty')"
    if [[ -z "$SERVICE_CALL_SERVICE_ID" ]]; then
      err "Could not resolve ${SERVICE_CALL_SERVICE_SLUG} service id after apply: $service_resp"
      return 1
    fi
    log "Resolved ${SERVICE_CALL_SERVICE_SLUG} service id: ${SERVICE_CALL_SERVICE_ID}"

    # The apply returns as soon as the Knative Service OBJECT is created — it
    # does NOT wait for a pod to be serving. Without this gate the suite races
    # the rollout: on a freshly-provisioned cluster the webhook fires seconds
    # later, the serviceCall hits a service with no ready endpoint, and
    # connector-runtime's circuit breaker (service-call.activity.ts's `deny`
    # path) opens on the failed attempts and denies the retries too, so the
    # execution ends FAILED. Verified twice against a from-scratch provision
    # before this gate existed. `minScale: 1` in the fixture keeps it warm
    # BETWEEN runs; this gate covers the FIRST run, where there is nothing to
    # keep warm yet.
    #
    # knativeName/namespace come from the registry response rather than being
    # rebuilt from the "<service>-<tenant>" / "<tenant>-dev-ns" conventions,
    # so this keeps working if those conventions ever change.
    local kn_name kn_ns
    kn_name="$(echo "$service_resp" | jq -r '.[0].knativeName // empty')"
    kn_ns="$(echo "$service_resp" | jq -r '.[0].namespace // empty')"
    if [[ -n "$kn_name" && -n "$kn_ns" ]]; then
      log "Waiting for ksvc/${kn_name} in ${kn_ns} to be Ready (timeout ${POLL_TIMEOUT_S}s)"
      local ready_deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
      local ksvc_ready=""
      while (( $(date +%s) < ready_deadline )); do
        # kubectl failure inside a poll loop -> retry, same convention as the
        # other poll loops here (a transient error is "not yet", not fatal).
        ksvc_ready="$(kubectl get ksvc "$kn_name" -n "$kn_ns" \
          -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")"
        [[ "$ksvc_ready" == "True" ]] && break
        sleep 3
      done
      if [[ "$ksvc_ready" != "True" ]]; then
        err "ksvc/${kn_name} did not become Ready within ${POLL_TIMEOUT_S}s — serviceCall stages would fail"
        return 1
      fi
      log "ksvc/${kn_name} is Ready"
    else
      warn "Registry response carried no knativeName/namespace — skipping the readiness gate"
    fi
  fi
}

stage_login() {
  log "Stage 1: login as ${EMAIL} (tenant ${TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"tenant_id\":\"${TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  if [[ -z "$TOKEN" ]]; then
    err "Login failed: $resp"
    return 1
  fi
}

stage_resolve_endpoint_id() {
  # Stage 1b (T04, manual-loops/connectors/endpoint-scoped-recent-calls.md):
  # resolves a REAL endpoint id off the pre-existing pokeapi adapter at run
  # time, via the gateway's connector detail route (GET /api/connectors/:id ->
  # connector-admin, connectors.controller.ts) using the same authenticated
  # api() transport every other stage uses. Never hardcoded: adapter endpoint
  # ids are server-generated and re-generated by every re-seed of the
  # connector (README.md's E2E_ENDPOINT_ADAPTER_ID stale-default caveat), so
  # a literal id here would rot exactly the same way. The resolved id feeds
  # (a) the manifest's 'probeEndpointScoped' action (stage 2/3) and (b)
  # stage 14b's `endpointId=` events filter.
  #
  # Runs BEFORE stage_apply_manifest because e2e_manifest_body interpolates
  # ENDPOINT_ID into the manifest it PUTs.
  log "Stage 1b: resolve an endpoint id on adapter ${ENDPOINT_ADAPTER_ID} (preferred ${ENDPOINT_PREFERRED_METHOD} ${ENDPOINT_PREFERRED_PATH})"
  local combined status body endpoint_count
  combined="$(api_status GET "/api/connectors/${ENDPOINT_ADAPTER_ID}")"
  status="$(api_status_code "$combined")"
  body="$(api_status_body "$combined")"
  if [[ "$status" != "200" ]]; then
    err "GET /api/connectors/${ENDPOINT_ADAPTER_ID} returned status ${status}: ${body}"
    err "The adapter id is probably stale (see scripts/e2e/README.md's E2E_ENDPOINT_ADAPTER_ID caveat) — re-seed the pokeapi connector and set E2E_ENDPOINT_ADAPTER_ID in scripts/e2e/.env"
    return 1
  fi
  endpoint_count="$(echo "$body" | jq '[.endpoints[]?] | length')"
  log "Adapter ${ENDPOINT_ADAPTER_ID} exposes ${endpoint_count} endpoint(s): $(echo "$body" | jq -c '[.endpoints[]? | {id, method, path}]')"

  local endpoint_row=""
  if [[ -n "$ENDPOINT_ID" ]]; then
    # Pinned via .env — still validated against the live adapter rather than
    # trusted blindly, so a stale pin fails HERE with a clear message instead
    # of silently producing an events filter that matches nothing in 14b.
    endpoint_row="$(echo "$body" | jq -c --arg id "$ENDPOINT_ID" \
      '[.endpoints[]? | select(.id == $id)][0] // empty')"
    if [[ -z "$endpoint_row" ]]; then
      err "E2E_ENDPOINT_ID '${ENDPOINT_ID}' is not an endpoint of adapter ${ENDPOINT_ADAPTER_ID}: ${body}"
      return 1
    fi
    log "Using pinned E2E_ENDPOINT_ID ${ENDPOINT_ID} (validated against the live adapter)"
  else
    endpoint_row="$(echo "$body" | jq -c \
      --arg m "$ENDPOINT_PREFERRED_METHOD" --arg p "$ENDPOINT_PREFERRED_PATH" \
      '[.endpoints[]? | select((.method | ascii_upcase) == ($m | ascii_upcase) and .path == $p)][0] // empty')"
    if [[ -z "$endpoint_row" ]]; then
      warn "Adapter ${ENDPOINT_ADAPTER_ID} has no '${ENDPOINT_PREFERRED_METHOD} ${ENDPOINT_PREFERRED_PATH}' endpoint — falling back to its first endpoint"
      endpoint_row="$(echo "$body" | jq -c '[.endpoints[]?][0] // empty')"
    fi
  fi
  if [[ -z "$endpoint_row" ]]; then
    err "Adapter ${ENDPOINT_ADAPTER_ID} exposes no endpoints at all — cannot exercise the adapter+endpoint (endpointId-bearing) endpointCall branch: ${body}"
    return 1
  fi

  ENDPOINT_ID="$(echo "$endpoint_row" | jq -r '.id // empty')"
  ENDPOINT_RESOLVED_PATH="$(echo "$endpoint_row" | jq -r '.path // empty')"
  if [[ -z "$ENDPOINT_ID" || -z "$ENDPOINT_RESOLVED_PATH" ]]; then
    err "Resolved endpoint row is missing id/path: ${endpoint_row}"
    return 1
  fi
  log "Resolved endpoint ${ENDPOINT_ID} ($(echo "$endpoint_row" | jq -r '.method') ${ENDPOINT_RESOLVED_PATH}) on adapter ${ENDPOINT_ADAPTER_ID}"
}

e2e_manifest_body() {
  # T2 (manual-loops/provisioning-manifest-gaps-3.md): the ONE
  # IntegrationManifest that replaces every imperative create this section
  # used to make (http channel account, echo agent, both e2e workflow
  # definitions) — see the header comment's provisioning section for the
  # full rationale, including the workflowComparable-existence-only finding
  # that forces both workflow NAMES (not just their trigger config) to carry
  # this run's nonce.
  #
  # `probeEndpoint.args.adapterId` and `probeService.args.serviceId` are
  # SYMBOLIC REFS (`{ connectorRef: pokeapi }` / `{ serviceRef: sample-echo }`),
  # resolved by name at apply time — not raw ids interpolated by this script.
  # Both resources are declared `external: true` in the `connectors`/`services`
  # sections below because they are created out-of-band, by
  # fixtures/e2e-prerequisites.yaml in stage 1a, not by this manifest. This is
  # the same mechanism the samples use for cross-manifest dependencies (see
  # integrations/http/hosted-services-api/manifest.yaml's `serviceRef`, and
  # the CRM demo's `external: true` Telegram account). `adapterId` ->
  # `connectorRef` and `serviceId` -> `serviceRef` are both entries in
  # provisioning-service's `SUBSTITUTION_ALLOWLIST`.
  #
  # `endpointId` (on `probeEndpointScoped`) is the one that CANNOT be a ref:
  # there is no `endpointRef` in that allowlist, so it stays resolved at run
  # time by stage_resolve_endpoint_id.
  #
  # `probeEndpointScoped` (T04,
  # manual-loops/connectors/endpoint-scoped-recent-calls.md) is a SECOND
  # endpointCall on the SAME adapter that additionally carries
  # `args.endpointId` (resolved at run time by stage_resolve_endpoint_id).
  # That arg pair routes connector-runtime to its `execute-with-adapter-
  # endpoint` branch, which publishes `endpointId: <id>` on the
  # endpoint_call_completed payload — whereas 'probeEndpoint' above, with
  # `adapterId` but no `endpointId`, takes `execute-with-adapter-base` and
  # publishes `endpointId: null` (execute-with-adapter-base.ts:126). Both
  # actions are kept: 'probeEndpoint' is what stages 13/14 assert on and is
  # deliberately left untouched. `args.url` is required to be a string by
  # workflow-action.validator.ts's isEndpointArgs but is IGNORED on this
  # branch (method/path come from the endpoint definition), so it carries the
  # resolved endpoint's own path for readability.
  #
  # `probeService` (T12): `data.nonce`
  # embeds `{{request.text}}` (the webhook nonce) so the serviceCall's
  # captured requestBody carries a value stage_verify_service_call_payload
  # can assert on.
  cat <<JSON
{
  "apiVersion": "yoizen.io/v1",
  "kind": "IntegrationManifest",
  "metadata": { "name": "${MANIFEST_NAME}" },
  "spec": {
    "channels": [
      { "name": "${CHANNEL_NAME}", "type": "http", "direction": "inbound" },
      { "name": "${EGRESS_CHANNEL_NAME}", "type": "e2e-tests", "direction": "outbound" }
    ],
    "connectors": [
      { "name": "pokeapi", "type": "http", "external": true }
    ],
    "services": [
      { "name": "${SERVICE_CALL_SERVICE_SLUG}", "external": true }
    ],
    "agents": [
      {
        "name": "${AGENT_NAME}",
        "profile": {
          "system_prompt": "You are the e2e echo agent. Echo the user's message back verbatim.",
          "model_config": { "provider": "mock", "model": "echo" }
        }
      }
    ],
    "workflows": [
      {
        "name": "${WORKFLOW_NAME}",
        "definition": {
          "application": "e2e",
          "actions": [
            {
              "name": "logMessage",
              "activity": "jsFunction",
              "args": {
                "code": "(ctx) => { console.log('[e2e-http-log]', ctx.request.from, ctx.request.text); return ctx.request.text; }"
              }
            },
            {
              "name": "probeEndpoint",
              "activity": "endpointCall",
              "args": {
                "adapterId": { "connectorRef": "pokeapi" },
                "method": "GET",
                "url": "/api/v2/pokemon/ditto"
              }
            },
            {
              "name": "probeService",
              "activity": "serviceCall",
              "args": {
                "serviceId": { "serviceRef": "${SERVICE_CALL_SERVICE_SLUG}" },
                "serviceSlug": "${SERVICE_CALL_SERVICE_SLUG}",
                "method": "POST",
                "path": "/anything",
                "data": { "nonce": "{{request.text}}" }
              }
            },
            {
              "name": "probeEndpointScoped",
              "activity": "endpointCall",
              "args": {
                "adapterId": { "connectorRef": "pokeapi" },
                "endpointId": "${ENDPOINT_ID}",
                "method": "GET",
                "url": "${ENDPOINT_RESOLVED_PATH}"
              }
            }
          ],
          "trigger": {
            "type": "message_received",
            "mode": "shared",
            "config": {
              "channels": ["http"],
              "providers": ["http"],
              "accountIds": [ { "channelRef": "${CHANNEL_NAME}" } ]
            }
          }
        }
      },
      {
        "name": "${COMPOSITE_WORKFLOW_NAME}",
        "definition": {
          "application": "e2e",
          "actions": [
            {
              "name": "compositeLog",
              "activity": "jsFunction",
              "args": {
                "code": "(ctx) => { console.log('[e2e-http-composite]', ctx.request.text); return ctx.request.text; }"
              }
            },
            {
              "name": "compositeService",
              "activity": "serviceCall",
              "args": {
                "serviceId": { "serviceRef": "${SERVICE_CALL_SERVICE_SLUG}" },
                "serviceSlug": "${SERVICE_CALL_SERVICE_SLUG}",
                "method": "POST",
                "path": "/anything",
                "data": { "nonce": "{{request.text}}" }
              }
            },
            {
              "name": "routeByNonce",
              "activity": "conditional",
              "branches": [
                {
                  "label": "${COMPOSITE_BRANCH_NEVER}",
                  "condition": {
                    "variable": "request.text",
                    "comparator": "eq",
                    "value": "__e2e_never_matches__"
                  },
                  "actions": [
                    {
                      "name": "wrongBranch",
                      "activity": "jsFunction",
                      "args": {
                        "code": "(ctx) => { console.log('${COMPOSITE_WRONG_BRANCH_MARKER}', ctx.request.text); return 'wrong'; }"
                      }
                    }
                  ]
                },
                {
                  "label": "${COMPOSITE_BRANCH_MATCH}",
                  "condition": {
                    "variable": "request.text",
                    "comparator": "contains",
                    "value": "e2e-"
                  },
                  "actions": [
                    {
                      "name": "callAgentInBranch",
                      "activity": "agentCall",
                      "args": {
                        "agentId": { "agentRef": "${AGENT_NAME}" },
                        "message": "{{request.text}}"
                      }
                    },
                    {
                      "name": "sendToSink",
                      "activity": "channelSend",
                      "args": {
                        "accountId": { "channelRef": "${EGRESS_CHANNEL_NAME}" },
                        "channel": "e2e-tests",
                        "provider": "e2e-tests",
                        "to": "${EGRESS_RECIPIENT}",
                        "type": "text",
                        "text": "{{request.text}}"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "name": "fanOut",
              "activity": "branch",
              "${BRANCH_ALPHA}": [
                {
                  "name": "alphaLog",
                  "activity": "jsFunction",
                  "args": {
                    "code": "(ctx) => { console.log('[e2e-http-composite] alpha', ctx.request.text); return 'alpha'; }"
                  }
                }
              ],
              "${BRANCH_BETA}": [
                {
                  "name": "betaBusPublish",
                  "activity": "serviceBusCall",
                  "args": {
                    "subject": "${BUS_PROBE_SUBJECT}",
                    "payload": { "nonce": "{{request.text}}", "probe": "e2e-bus" }
                  }
                }
              ]
            }
          ],
          "trigger": {
            "type": "message_received",
            "mode": "shared",
            "config": {
              "channels": ["http"],
              "providers": ["http"],
              "accountIds": [ { "channelRef": "${CHANNEL_NAME}" } ]
            }
          }
        }
      },
      {
        "name": "${AGENT_WORKFLOW_NAME}",
        "definition": {
          "application": "e2e",
          "actions": [
            {
              "name": "callAgent",
              "activity": "agentCall",
              "args": {
                "agentId": { "agentRef": "${AGENT_NAME}" },
                "message": "{{request.text}}"
              }
            }
          ],
          "trigger": {
            "type": "message_received",
            "mode": "shared",
            "config": {
              "channels": ["http"],
              "providers": ["http"],
              "accountIds": [ { "channelRef": "${CHANNEL_NAME}" } ]
            }
          }
        }
      }
    ]
  }
}
JSON
}

stage_apply_manifest() {
  # Stage 2/3/3a/3b (T2): PUT the manifest -> plan (log-only: verdicts
  # legitimately vary run to run, channel/workflows always 'create', agent
  # 'create' on the very first run and 'noop' every run after) -> apply.
  # Talks to provisioning-service via the gateway's T07 proxy routes
  # (/api/provisioning/manifests/...), reusing the SAME authenticated
  # api()/api_status() transport every other stage in this script already
  # uses — no new curl idiom, no direct-ingress bypass.
  log "Stage 2/3: PUT manifest '${MANIFEST_NAME}' (channel='${CHANNEL_NAME}', agent='${AGENT_NAME}', workflows=['${WORKFLOW_NAME}','${AGENT_WORKFLOW_NAME}'])"
  local body put_resp put_revision
  body="$(e2e_manifest_body)"
  put_resp="$(api PUT "/api/provisioning/manifests/${MANIFEST_NAME}" "$body")"
  put_revision="$(echo "$put_resp" | jq -r '.revision // empty')"
  if [[ -z "$put_revision" ]]; then
    err "Manifest PUT did not return a revision: $put_resp"
    return 1
  fi
  log "Manifest '${MANIFEST_NAME}' PUT -> revision ${put_revision}"

  log "Stage 2/3: POST plan (log-only — verdicts legitimately vary run to run)"
  local plan_resp
  # '{}' body: api() always sets Content-Type: application/json, so an
  # empty-body POST 400s at the gateway ("Body cannot be empty ..."), same
  # gotcha every DELETE call in this script already works around.
  plan_resp="$(api POST "/api/provisioning/manifests/${MANIFEST_NAME}/plan" '{}')"
  log "Plan verdicts: $(echo "$plan_resp" | jq -c '[.resources[] | {kind, name, verdict}]')"

  log "Stage 2/3: POST apply"
  local apply_resp applied_count
  apply_resp="$(api POST "/api/provisioning/manifests/${MANIFEST_NAME}/apply" '{}')"
  applied_count="$(echo "$apply_resp" | jq -r '.appliedCount // empty')"
  if [[ -z "$applied_count" ]]; then
    err "Manifest apply failed or returned no appliedCount: $apply_resp"
    return 1
  fi
  log "Manifest applied: appliedCount=${applied_count} noopCount=$(echo "$apply_resp" | jq -r '.noopCount // 0')"

  # T08: accountId — see this var's declaration comment above.
  ACCOUNT_ID="$(echo "$apply_resp" | jq -r --arg n "$CHANNEL_NAME" '.resources[] | select(.name == $n) | .externalId')"
  AGENT_ID="$(echo "$apply_resp" | jq -r --arg n "$AGENT_NAME" '.resources[] | select(.name == $n) | .externalId')"
  WORKFLOW_ID="$(echo "$apply_resp" | jq -r --arg n "$WORKFLOW_NAME" '.resources[] | select(.name == $n) | .externalId')"
  AGENT_WORKFLOW_ID="$(echo "$apply_resp" | jq -r --arg n "$AGENT_WORKFLOW_NAME" '.resources[] | select(.name == $n) | .externalId')"
  COMPOSITE_WORKFLOW_ID="$(echo "$apply_resp" | jq -r --arg n "$COMPOSITE_WORKFLOW_NAME" '.resources[] | select(.name == $n) | .externalId')"
  if [[ -z "$COMPOSITE_WORKFLOW_ID" ]]; then
    err "Manifest apply response missing the composite workflow's externalId: $apply_resp"
    return 1
  fi
  EGRESS_ACCOUNT_ID="$(echo "$apply_resp" | jq -r --arg n "$EGRESS_CHANNEL_NAME" '.resources[] | select(.name == $n) | .externalId')"
  if [[ -z "$EGRESS_ACCOUNT_ID" ]]; then
    err "Manifest apply response missing the e2e-tests sink account's externalId: $apply_resp"
    return 1
  fi
  log "Resolved e2e-tests sink account: ${EGRESS_ACCOUNT_ID}"
  if [[ -z "$ACCOUNT_ID" || -z "$AGENT_ID" || -z "$WORKFLOW_ID" || -z "$AGENT_WORKFLOW_ID" ]]; then
    err "Manifest apply response missing an expected resource externalId (channel=${ACCOUNT_ID:-<empty>} agent=${AGENT_ID:-<empty>} workflow=${WORKFLOW_ID:-<empty>} agentWorkflow=${AGENT_WORKFLOW_ID:-<empty>}): $apply_resp"
    return 1
  fi
  log "Resolved externalIds: channel=${ACCOUNT_ID} agent=${AGENT_ID} workflow=${WORKFLOW_ID} agentWorkflow=${AGENT_WORKFLOW_ID}"
}

stage_fetch_channel_secret() {
  # The manifest apply engine never returns appSecret (channels-writer.ts
  # intentionally discards everything but externalId — it is not a
  # declarative manifest-schema field, and the T05 secrets broker only
  # resolves secretRef-declared VALUES the manifest supplies, never
  # server-generated ones). But GET /api/channels/accounts/:id (via the
  # gateway) DOES return the SAME appSecret the create response would have —
  # verified live: channel-service's AccountsService/AccountsController apply
  # no masking on read — so one extra authenticated GET recovers it using the
  # channel's externalId from stage_apply_manifest.
  log "Stage 2/3: fetch appSecret for channel account ${ACCOUNT_ID}"
  local resp
  resp="$(api GET "/api/channels/accounts/${ACCOUNT_ID}")"
  APP_SECRET="$(echo "$resp" | jq -r '.appSecret // empty')"
  if [[ -z "$APP_SECRET" ]]; then
    err "GET /api/channels/accounts/${ACCOUNT_ID} did not return appSecret: $resp"
    return 1
  fi
}

stage_ensure_agent_published() {
  # Agent PUBLISH is a runtime activation step, not a declarative manifest
  # property (agentSchema has no such field, and agents-writer.ts never
  # calls the publish endpoint) — so it stays an explicit imperative POST
  # after apply, exactly like the workflow enable/disable toggle (stage 6/8)
  # stays imperative. provider MUST be "mock" (the dev echo provider, gated
  # by RUNTIME_ALLOW_MOCK_PROVIDER=true in provider-registry.service.ts,
  # already declared in the manifest's agent profile above) — any other
  # provider name is unsupported and the runtime execution ends
  # execution_failed, which would leave every span at duration_ms == 0 (see
  # BLOCKED.md).
  log "Stage 2/3: ensure agent ${AGENT_ID} ('${AGENT_NAME}') is published"
  local get_resp agent_status
  get_resp="$(api GET "/api/admin/agents/${AGENT_ID}")"
  agent_status="$(echo "$get_resp" | jq -r '.status // empty')"
  if [[ "$agent_status" == "published" ]]; then
    log "Agent ${AGENT_ID} already published"
    return 0
  fi
  log "Publishing agent ${AGENT_ID}"
  local publish_resp publish_status
  # api() always sets Content-Type: application/json; an empty body then
  # 400s with "Body cannot be empty" — an explicit '{}' is required.
  publish_resp="$(api POST "/api/admin/agents/${AGENT_ID}/publish" '{}')"
  publish_status="$(echo "$publish_resp" | jq -r '.status // empty')"
  if [[ "$publish_status" != "published" ]]; then
    err "Agent publish failed: $publish_resp"
    return 1
  fi
  log "Agent ready: ${AGENT_ID} (published)"
}

stage_send_message() {
  # stage_send_message <nonce>
  local nonce="$1"
  log "Stage 4: POST webhook message with nonce ${nonce}"
  # Same --connect-timeout/RESOLVE_ARGS mDNS short-circuit as api()/api_status()
  # — this webhook POST pays the same ~5s macOS mDNS tax otherwise.
  local resp status
  local webhook_args=(-s --connect-timeout 10 --max-time 45 -X POST "${API_URL}/api/webhooks/http/${TENANT}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-http-channel-token: ${APP_SECRET}"
    -d "{\"from\":\"e2e-user\",\"text\":\"${nonce}\"}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && webhook_args+=("${RESOLVE_ARGS[@]}")
  resp="$(curl "${webhook_args[@]}")"
  status="$(echo "$resp" | jq -r '.status // empty')"
  if [[ "$status" != "accepted" ]]; then
    err "Webhook not accepted: $resp"
    return 1
  fi
}

stage_verify_execution() {
  # stage_verify_execution <nonce>
  local nonce="$1"
  log "Stage 5: wait for workflow execution + console.log (timeout ${POLL_TIMEOUT_S}s, nonce ${nonce})"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  while (( $(date +%s) < deadline )); do
    # Capture logs into a var THEN grep — never `kubectl logs | grep -q`.
    # Under `set -o pipefail`, a matching `grep -q` closes the pipe and exits
    # instantly; kubectl, still writing, takes SIGPIPE (141) and that becomes
    # the pipeline's status, so the `if` takes the FALSE branch exactly when
    # the nonce WAS present — a timing race that made this poll spuriously
    # "miss" completed runs. `$(...)` capture reads to EOF and is immune.
    local logs
    logs="$(kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=workflow-worker \
        --since=5m --tail=5000 2>/dev/null || true)"
    if grep -q "$nonce" <<<"$logs"; then
      log "console.log with nonce found in workflow-worker logs"
      return 0
    fi
    sleep 3
  done
  err "Nonce ${nonce} not seen in workflow-worker logs within ${POLL_TIMEOUT_S}s"
  err "Recent executions:"
  api GET "/api/workflows/${WORKFLOW_ID}/executions" | jq '.' >&2 || true
  return 1
}

stage_wait_execution_completed() {
  # stage_wait_execution_completed <nonce>
  #
  # Stage 5b: waits for the '${WORKFLOW_NAME}' execution matching <nonce> to
  # reach a terminal COMPLETED status. Necessary because '${WORKFLOW_NAME}'
  # now has FOUR actions (T06, T12, T04): stage_verify_execution returns the
  # moment the FIRST action's console.log appears, but the slower remaining
  # actions (the two endpointCall probes — adapter-base and adapter+endpoint
  # — and the serviceCall probe, all over the network) may still be running. Without this wait, stage 6's disable+terminate can
  # kill the happy-path execution mid-flight, so it never records
  # result.causal.correlation_id (stage 9 then fails) and never emits its
  # endpoint_call_completed events (stages 13/14, 15/16/17). Polling the
  # executions list by nonce reuses stage 9's lookup.
  local nonce="$1"
  log "Stage 5b: wait for '${WORKFLOW_NAME}' execution (nonce ${nonce}) to reach COMPLETED (timeout ${POLL_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  local status=""
  while (( $(date +%s) < deadline )); do
    # curl/jq timeout inside a poll loop -> retry (pipefail would else abort)
    status="$(api GET "/api/workflows/${WORKFLOW_ID}/executions?pageSize=100" \
      | jq -r ".items[]? | select(.request.text == \"${nonce}\") | .status" | head -1)" || true
    if [[ "$status" == "COMPLETED" ]]; then
      log "Execution for nonce ${nonce} reached COMPLETED"
      return 0
    fi
    sleep 3
  done
  err "Execution for nonce ${nonce} did not reach COMPLETED within ${POLL_TIMEOUT_S}s (last status '${status}')"
  return 1
}

stage_verify_fan_out() {
  # FAN-OUT COVERAGE: asserts the composite workflow's `fanOut` branch action
  # ran BOTH of its branches, and that the `serviceBusCall` nested inside one
  # of them completed.
  #
  # The branch LABEL is the load-bearing part. `branch` runs its branches
  # concurrently on cloned contexts, so "the workflow completed" would also
  # hold if only one branch had run — the engine merges whatever came back
  # without noticing an absent branch. Each nested action's step event carries
  # its enclosing branch label (`branch` on the action payload, set only when
  # nested), so requiring BOTH labels is what actually proves the fan-out
  # happened.
  #
  # The bus probe is asserted by actionType rather than by reading the subject
  # off NATS: `executeServiceBusCall` publishes a RAW payload to an ad-hoc
  # unbound subject over core NATS, so there is no stream to read it back
  # from. Its action_completed with `status: ok` is the platform's own record
  # that the publish succeeded — the activity throws otherwise.
  log "Stage 20: verify fan-out branches + nested serviceBusCall (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify the fan-out"
    return 1
  fi

  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local labels=""
  while (( $(date +%s) < deadline )); do
    # kubectl/psql failure inside a poll loop -> retry, same as stages 13/15/19.
    labels="$(kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- \
      psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc \
      "select distinct envelope->'data'->'payload'->>'branch' from tracking.tracked_events where kind = 'action_completed' and correlation_id = '${CORRELATION_ID}' and envelope->'data'->'payload'->>'branch' is not null;" \
      2>/dev/null)" || true
    if grep -q "$BRANCH_ALPHA" <<<"$labels" && grep -q "$BRANCH_BETA" <<<"$labels"; then
      break
    fi
    sleep 3
  done
  if ! grep -q "$BRANCH_ALPHA" <<<"$labels"; then
    err "No action_completed carrying branch '${BRANCH_ALPHA}' for correlation ${CORRELATION_ID} — that branch did not run (labels seen: ${labels:-<none>})"
    return 1
  fi
  if ! grep -q "$BRANCH_BETA" <<<"$labels"; then
    err "No action_completed carrying branch '${BRANCH_BETA}' for correlation ${CORRELATION_ID} — that branch did not run (labels seen: ${labels:-<none>})"
    return 1
  fi
  log "Confirmed: both fan-out branches ran ('${BRANCH_ALPHA}' and '${BRANCH_BETA}')"

  # The nested `serviceBusCall`. Its `action_completed` with `status: ok` is
  # the platform's own record that the publish succeeded — the activity throws
  # otherwise — and it is asserted rather than read back off NATS because the
  # publish goes to an ad-hoc UNBOUND subject over core NATS, so there is no
  # stream to read it from.
  #
  # This action is also the regression guard for a real bug it surfaced:
  # `js.publish()` to an unbound subject fails with a bare `503`, and
  # `service-bus.activity.ts`'s fallback used to be gated on the publish
  # error's TEXT matching "no stream matches" — a phrase only the
  # `$JS.API.STREAM.NAMES` probe ever emits, never the publish. The documented
  # ad-hoc fan-out fallback therefore never fired. It now disambiguates by
  # asking JetStream (probe answers "no stream matches" -> fall back; probe
  # itself gets no answer -> JetStream is down, propagate). If that regresses,
  # this assertion goes red.
  local bus_status=""
  bus_status="$(kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- \
    psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc \
    "select envelope->'data'->'payload'->>'status' from tracking.tracked_events where kind = 'action_completed' and correlation_id = '${CORRELATION_ID}' and envelope->'data'->'payload'->>'actionType' = 'serviceBusCall' limit 1;" \
    2>/dev/null)" || true
  if [[ "$bus_status" != "ok" ]]; then
    err "serviceBusCall action_completed status='${bus_status:-<none>}', expected 'ok' — the bus publish did not succeed"
    return 1
  fi
  log "Confirmed: nested serviceBusCall completed ok (subject ${BUS_PROBE_SUBJECT})"
}

stage_verify_egress_sent() {
  # EGRESS COVERAGE: asserts the composite workflow's `sendToSink` channelSend
  # produced a real `sent.v1` row — the event `EgressService` publishes ONLY
  # from inside `if (result.success)` (channel-service's egress.service.ts).
  # Reaching that branch at all is the whole point of the `e2e-tests` sink
  # channel: `http` fails the send by design and the three real channels need
  # live credentials, so before this the egress publish path had no coverage
  # and this table held zero `sent` rows.
  #
  # Asserted on three axes so a coincidental row cannot pass it: the kind, the
  # channel the send went out on, and the happy-path correlation_id. The
  # payload check below then proves the message BODY survived the round trip,
  # not merely that some send happened.
  #
  # Same direct-SQL shape and polling as stages 13/15 — the row is written
  # asynchronously by the tracking ingester (whose ingress consumer sets no
  # filterSubject, so it sees `sent.v1` like every other `evt.<tenant>.>`).
  log "Stage 19: assert sent.v1 row for channel e2e-tests shares correlation_id ${CORRELATION_ID} (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify the egress send"
    return 1
  fi
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local found=""
  while (( $(date +%s) < deadline )); do
    # kubectl/psql failure inside a poll loop -> retry, same as stages 13/15.
    found="$(kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- \
      psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc \
      "select event_id from tracking.tracked_events where kind = 'sent' and envelope->>'channel' = 'e2e-tests' and correlation_id = '${CORRELATION_ID}' limit 1;" \
      2>/dev/null)" || true
    [[ -n "$found" ]] && break
    sleep 3
  done
  if [[ -z "$found" ]]; then
    err "No sent.v1 row (channel e2e-tests) found for correlation_id ${CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s — the egress publish path did not run"
    return 1
  fi
  log "Confirmed: sent.v1 row ${found} (channel e2e-tests) shares correlation_id ${CORRELATION_ID}"

  # `sent.v1` is an egress CONFIRMATION, not a copy of the message: its
  # payload carries `to`/`type`/`accountId`/`providerMessageId` and
  # deliberately NOT the message text (verified against a live row). So the
  # assertion below is on what the platform actually publishes, and it still
  # pins the two things that matter:
  #   * `providerMessageId` starting with `e2e-` — only E2eTestsProvider mints
  #     that prefix, so the success came from the sink and not from some other
  #     provider or a stubbed result;
  #   * `to`/`accountId` — the channelSend action's own args reached the
  #     provider intact, on the sink account this run provisioned.
  # Run-scoping is already covered: correlation_id above is a per-run UUID.
  local payload=""
  payload="$(kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- \
    psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc \
    "select concat_ws('|', envelope->'data'->'payload'->>'providerMessageId', envelope->'data'->'payload'->>'to', envelope->'data'->'payload'->>'accountId') from tracking.tracked_events where event_id = '${found}';" \
    2>/dev/null)" || true
  local got_msg_id="${payload%%|*}"
  local rest="${payload#*|}"
  local got_to="${rest%%|*}"
  local got_account="${rest##*|}"

  if [[ "$got_msg_id" != e2e-* ]]; then
    err "sent.v1 row ${found} providerMessageId='${got_msg_id:-<none>}' does not carry the sink's 'e2e-' prefix — the success did not come from E2eTestsProvider"
    return 1
  fi
  if [[ "$got_to" != "$EGRESS_RECIPIENT" ]]; then
    err "sent.v1 row ${found} to='${got_to:-<none>}', expected '${EGRESS_RECIPIENT}' — the channelSend args did not reach the provider"
    return 1
  fi
  if [[ "$got_account" != "$EGRESS_ACCOUNT_ID" ]]; then
    err "sent.v1 row ${found} accountId='${got_account:-<none>}', expected '${EGRESS_ACCOUNT_ID}' — the send went out on the wrong account"
    return 1
  fi
  log "Confirmed: sent.v1 payload carries providerMessageId=${got_msg_id}, to=${got_to}, accountId=${got_account}"
}

stage_verify_conditional() {
  # COMPOSITION COVERAGE: asserts the third workflow's chain
  # (jsFunction -> serviceCall -> conditional{agentCall}) behaved correctly.
  # Three independent signals, because "the run completed" alone would also
  # pass if the engine silently took the wrong branch or skipped the
  # conditional entirely:
  #   (a) the composite execution reached COMPLETED for this nonce;
  #   (b) the deliberately-false FIRST branch never executed — its marker is
  #       absent from the worker log (this is what proves top-to-bottom
  #       ordering rather than "always take branch 0");
  #   (c) a condition_evaluated event was emitted onto this run's chain, and
  #       its payload names the SECOND branch as the one taken.
  local nonce="$1"
  log "Stage 18: verify composite workflow's conditional (nonce ${nonce}, timeout ${POLL_TIMEOUT_S}s)"

  # (a) — same executions-by-nonce poll shape as stage 5b.
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  local status=""
  while (( $(date +%s) < deadline )); do
    status="$(api GET "/api/workflows/${COMPOSITE_WORKFLOW_ID}/executions?pageSize=100" \
      | jq -r ".items[]? | select(.request.text == \"${nonce}\") | .status" | head -1)" || true
    [[ "$status" == "COMPLETED" ]] && break
    [[ "$status" == "FAILED" ]] && break
    sleep 3
  done
  if [[ "$status" != "COMPLETED" ]]; then
    err "Composite workflow execution for nonce ${nonce} did not reach COMPLETED (last status '${status:-<none>}')"
    return 1
  fi
  log "Composite execution reached COMPLETED"

  # (b) — capture-then-grep, never `kubectl logs | grep -q` (see the SIGPIPE
  # note in stage_verify_execution).
  local logs
  logs="$(kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=workflow-worker \
      --since=10m --tail=5000 2>/dev/null || true)"
  if grep -q "$COMPOSITE_WRONG_BRANCH_MARKER" <<<"$logs"; then
    err "The deliberately-false first branch ('${COMPOSITE_BRANCH_NEVER}') EXECUTED — conditional is not evaluating branches in order"
    return 1
  fi
  log "Confirmed: false first branch ('${COMPOSITE_BRANCH_NEVER}') never executed"

  # (c) — condition_evaluated on this run's chain, and which branch it took.
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify condition_evaluated"
    return 1
  fi
  local cond_event_id
  cond_event_id="$(api GET "/api/tracking/chains/${CORRELATION_ID}" \
    | jq -r '.events[]? | select(.kind == "condition_evaluated") | .event_id' | head -1)" || true
  if [[ -z "$cond_event_id" ]]; then
    err "No condition_evaluated event found on chain ${CORRELATION_ID}"
    return 1
  fi
  log "Found condition_evaluated event ${cond_event_id}"

  local combined status_code body branch_taken
  combined="$(api_status GET "/api/tracking/chains/${CORRELATION_ID}/events/${cond_event_id}/payload")"
  status_code="$(api_status_code "$combined")"
  body="$(api_status_body "$combined")"
  if [[ "$status_code" != "200" ]]; then
    err "condition_evaluated payload fetch returned ${status_code}: ${body}"
    return 1
  fi
  branch_taken="$(echo "$body" | jq -r '.. | .branchTaken? // empty' | head -1)"
  if [[ "$branch_taken" != "$COMPOSITE_BRANCH_MATCH" ]]; then
    err "condition_evaluated reports branchTaken='${branch_taken:-<none>}', expected '${COMPOSITE_BRANCH_MATCH}': ${body}"
    return 1
  fi
  log "Confirmed: conditional took branch '${branch_taken}' with a nested agentCall"
}

stage_disable_workflow() {
  log "Stage 6: PATCH /workflows/${WORKFLOW_ID}/status -> disabled"
  local resp terminated
  resp="$(api PATCH "/api/workflows/${WORKFLOW_ID}/status" '{"status":"disabled"}')"
  terminated="$(echo "$resp" | jq -r '.terminated // empty')"
  if [[ -z "$terminated" ]]; then
    err "Disable response missing 'terminated' count: $resp"
    return 1
  fi
  # From this point on the trap must re-enable the workflow before exiting,
  # whatever happens next.
  WORKFLOW_DISABLED=1
  log "Workflow disabled, terminated=${terminated} in-flight execution(s)"
}

stage_capture_execution_ids() {
  # stage_capture_execution_ids
  # Snapshots the execution ids currently on record for WORKFLOW_ID so
  # stage_verify_no_execution can assert the set is unchanged afterwards.
  # Echoes the ids (one per line) on stdout; caller captures via $().
  api GET "/api/workflows/${WORKFLOW_ID}/executions" | jq -r '.items[]?.id // empty' | sort
}

stage_verify_no_execution() {
  # stage_verify_no_execution <nonce>
  #
  # A disabled workflow's trigger is rejected inside workflow-service-worker's
  # TriggerConsumerService (trigger-consumer.service.ts) via a
  # ConflictException(code: WORKFLOW_DISABLED), which is caught, logged as a
  # warn ("Skipped trigger for disabled workflow ...", never surfaces
  # anywhere near workflow-worker's Temporal activity logs), and acked
  # without ever calling temporal.workflow.start(...). So this stage cannot
  # grep the jsFunction's console.log the way stage_verify_execution does —
  # that log line structurally never appears for a disabled workflow,
  # whether the system correctly refused the trigger or the whole pipeline
  # is silently broken. Instead:
  #   1. POSITIVELY wait (bounded, POLL_TIMEOUT_S-style) for the
  #      trigger-consumer's own skip warn line in workflow-service-worker
  #      logs. This proves the message ARRIVED at the trigger consumer and
  #      was explicitly refused — not merely "never showed up because
  #      something upstream is broken."
  #   2. THEN assert against the executions API (source of truth per the
  #      task spec) that the set of execution ids for WORKFLOW_ID is
  #      unchanged from the snapshot taken before this nonce was sent.
  local nonce="$1"
  local ids_before="$2"
  log "Stage 7: assert workflow trigger is skipped for nonce ${nonce} (timeout ${DISABLED_CHECK_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + DISABLED_CHECK_TIMEOUT_S ))
  local skip_seen=0
  while (( $(date +%s) < deadline )); do
    # Same SIGPIPE+pipefail hazard as stage_verify_execution: capture the
    # logs into a var FIRST, then grep the captured string — a piped
    # `kubectl logs | grep -q` can report "not found" precisely when the
    # line IS present, because the matching grep closes the pipe and
    # kubectl's SIGPIPE (141) becomes the pipeline status under pipefail.
    local skip_logs
    skip_logs="$(kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=workflow-service-worker \
        --since=5m --tail=5000 2>/dev/null || true)"
    if grep -q "Skipped trigger for disabled workflow ${WORKFLOW_NAME} (${WORKFLOW_ID})" <<<"$skip_logs"; then
      log "Confirmed: trigger-consumer skip line found for workflow ${WORKFLOW_ID}"
      skip_seen=1
      break
    fi
    sleep 3
  done
  if [[ "$skip_seen" -ne 1 ]]; then
    err "Never saw trigger-consumer skip line for workflow ${WORKFLOW_ID} within ${DISABLED_CHECK_TIMEOUT_S}s — cannot confirm the message even arrived"
    return 1
  fi

  local ids_after
  ids_after="$(stage_capture_execution_ids)"
  if [[ "$ids_after" != "$ids_before" ]]; then
    err "Execution set for workflow ${WORKFLOW_ID} changed while disabled"
    err "Before: ${ids_before}"
    err "After:  ${ids_after}"
    return 1
  fi
  log "Confirmed: no new execution recorded for workflow ${WORKFLOW_ID} while disabled"
}

stage_enable_workflow() {
  log "Stage 8: PATCH /workflows/${WORKFLOW_ID}/status -> enabled"
  local resp status
  resp="$(api PATCH "/api/workflows/${WORKFLOW_ID}/status" '{"status":"enabled"}')"
  status="$(echo "$resp" | jq -r '.status // empty')"
  if [[ "$status" != "enabled" ]]; then
    err "Enable response did not report status=enabled: $resp"
    return 1
  fi
  WORKFLOW_DISABLED=0
  log "Workflow re-enabled"
}

stage_capture_correlation_id() {
  # stage_capture_correlation_id <nonce>
  #
  # Resolves the correlation_id of the happy-path run via the log-workflow's
  # execution detail (`result.causal.correlation_id`). CRITICAL: assigns
  # directly to the global CORRELATION_ID rather than being invoked in a
  # command substitution — log()/warn()/err() write to stdout too, and an
  # earlier attempt at this task captured a log line instead of the id
  # because the whole function was wrapped in $(...).
  local nonce="$1"
  log "Stage 9: resolve correlation_id for nonce ${nonce} (timeout ${POLL_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  local execution_id="" execution_row=""
  while (( $(date +%s) < deadline )); do
    # curl timeouts inside poll loops degrade to a retry — pipefail would otherwise abort the script
    execution_row="$(api GET "/api/workflows/${WORKFLOW_ID}/executions?pageSize=100" \
      | jq -c ".items[]? | select(.request.text == \"${nonce}\")" | head -1)" || true
    [[ -n "$execution_row" ]] && break
    sleep 3
  done
  if [[ -z "$execution_row" ]]; then
    err "No execution of workflow ${WORKFLOW_ID} found for nonce ${nonce} within ${POLL_TIMEOUT_S}s"
    return 1
  fi
  execution_id="$(echo "$execution_row" | jq -r '.id // empty')"
  if [[ -z "$execution_id" ]]; then
    err "Execution row for nonce ${nonce} missing 'id': ${execution_row}"
    return 1
  fi
  HAPPY_PATH_EXECUTION_ID="$execution_id"
  # Same executions-list row already carries the real Temporal ids
  # (IWorkflowExecutionListItem.temporalWorkflowId/temporalRunId,
  # workflows.service.ts's mapExecutionRow) — captured here for stage 12
  # (stage_verify_run) so it never needs a second poll.
  HAPPY_PATH_WORKFLOW_ID="$(echo "$execution_row" | jq -r '.temporalWorkflowId // empty')"
  HAPPY_PATH_RUN_ID="$(echo "$execution_row" | jq -r '.temporalRunId // empty')"
  if [[ -z "$HAPPY_PATH_WORKFLOW_ID" || -z "$HAPPY_PATH_RUN_ID" ]]; then
    err "Execution ${execution_id} missing temporalWorkflowId/temporalRunId: ${execution_row}"
    return 1
  fi
  log "Found execution ${execution_id} for nonce ${nonce} (temporalWorkflowId=${HAPPY_PATH_WORKFLOW_ID}, temporalRunId=${HAPPY_PATH_RUN_ID}); polling for causal.correlation_id"

  while (( $(date +%s) < deadline )); do
    local correlation_id
    # timeout -> retry
    correlation_id="$(api GET "/api/workflows/${WORKFLOW_ID}/executions/${execution_id}" \
      | jq -r '.result.causal.correlation_id // empty')" || true
    if [[ -n "$correlation_id" ]]; then
      # Enforce the UUID invariant in code (not by convention): every
      # downstream stage interpolates CORRELATION_ID into a URL path (stages
      # 10/11/14) or directly into a psql string (stage 13). Failing fast here
      # guarantees it is a canonical UUID before any of those uses.
      if [[ ! "$correlation_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
        err "Captured correlation_id is not a valid UUID: '${correlation_id}'"
        return 1
      fi
      CORRELATION_ID="$correlation_id"
      log "Captured correlation_id ${CORRELATION_ID}"
      return 0
    fi
    sleep 3
  done
  err "Execution ${execution_id} never reported result.causal.correlation_id within ${POLL_TIMEOUT_S}s"
  return 1
}

stage_verify_chain() {
  log "Stage 10: GET /api/tracking/chains/${CORRELATION_ID} (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify chain"
    return 1
  fi
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local combined body status
  while (( $(date +%s) < deadline )); do
    # timeout -> retry
    combined="$(api_status GET "/api/tracking/chains/${CORRELATION_ID}")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      local events_ok orphan_ok nonzero_span_ok execution_started_ok workflow_span_ok
      events_ok="$(echo "$body" | jq '(.events | length) >= 5')"
      orphan_ok="$(echo "$body" | jq '(.summary.orphan_count | type) == "number"')"
      nonzero_span_ok="$(echo "$body" | jq '([.spans[]? | select(.duration_ms > 0)] | length) >= 1')"
      # T02 (manual-loops/workflow-step-events.md): the chain must contain
      # an execution_started event for the happy-path run...
      execution_started_ok="$(echo "$body" | jq '([.events[]? | select(.kind == "execution_started")] | length) >= 1')"
      # ...and the execution_started/execution_completed pair for the
      # workflow execution itself (entity_id == the Temporal-run
      # executionId captured in stage 9, kind_prefix == "execution" per
      # tracking.tracked_event_spans's pairing) must yield duration_ms > 0.
      # This is the specific workflow-level span assertion that REPLACES
      # the prior reliance on the agent-path's nonzero span (nonzero_span_ok
      # above still passes via either the agent or the workflow execution
      # now, and stays as a general "some span paired" sanity check).
      workflow_span_ok="$(echo "$body" | jq --arg eid "$HAPPY_PATH_EXECUTION_ID" \
        '([.spans[]? | select(.entity_id == $eid and .kind_prefix == "execution" and .duration_ms > 0)] | length) >= 1')"
      if [[ "$events_ok" == "true" && "$orphan_ok" == "true" && "$nonzero_span_ok" == "true" \
            && "$execution_started_ok" == "true" && "$workflow_span_ok" == "true" ]]; then
        log "Chain verified: events>=5=${events_ok} orphan_count-numeric=${orphan_ok} nonzero-span=${nonzero_span_ok} execution_started=${execution_started_ok} workflow-span=${workflow_span_ok}"
        CHAIN_BODY="$body"
        return 0
      fi
      log "Chain not yet complete (events>=5=${events_ok} orphan_count-numeric=${orphan_ok} nonzero-span=${nonzero_span_ok} execution_started=${execution_started_ok} workflow-span=${workflow_span_ok}); retrying"
    else
      log "Chain endpoint returned status ${status}; retrying"
    fi
    sleep 3
  done
  err "Chain assertions never satisfied for correlation ${CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s"
  err "Last response (status ${status}): ${body}"
  return 1
}

stage_verify_step_events() {
  # Stage 10b (T05, manual-loops/workflow-step-events.md): verifies T03's
  # action_started/action_completed step events landed on the same chain
  # stage 10 already verified, checks the actionIndex payload field, and
  # measures/logs the event-count volume multiplier.
  #
  # actionIndex verification approach: the chain LIST endpoint
  # (GET /chains/:correlationId) deliberately EXCLUDES the raw envelope jsonb
  # from every row (build-chain-query.ts's CHAIN_COLUMNS / has_envelope
  # comment), and `action_index` is not a column on tracking.tracked_events —
  # it only exists inside the envelope's `data.payload`. So it cannot be
  # asserted from the chain response. Instead this stage picks one
  # action_started event_id from the chain and fetches its payload via
  # GET /chains/:correlationId/events/:eventId/payload (same admin-authed
  # endpoint stage 11 already exercises), asserting `payload.actionIndex` is
  # present and numeric there.
  #
  # actionIndex ORDERING note: both e2e workflows here (e2e-http-log,
  # e2e-http-agent) have exactly one action each, so every action_started/
  # action_completed pair on this chain carries actionIndex 0 — this flow
  # can only assert the field is present and numeric, NOT exercise ordering
  # across multiple actions of the same workflow (that needs a multi-action
  # workflow definition, out of scope for this single-action http-webhook
  # e2e; T03's unit tests already cover multi-action ordering).
  log "Stage 10b: verify action_started/action_completed pairs, actionIndex, and volume cap"
  if [[ -z "$CHAIN_BODY" ]]; then
    err "CHAIN_BODY is empty — stage_verify_chain (stage 10) must run first"
    return 1
  fi

  local started_count completed_count total_events
  started_count="$(echo "$CHAIN_BODY" | jq '[.events[]? | select(.kind == "action_started")] | length')"
  completed_count="$(echo "$CHAIN_BODY" | jq '[.events[]? | select(.kind == "action_completed")] | length')"
  total_events="$(echo "$CHAIN_BODY" | jq '.events | length')"

  # e2e-http-log's single jsFunction action + e2e-http-agent's single
  # agentCall action (stages 3/3b, same happy-path trigger) -> >=2
  # action_started/action_completed PAIRS expected on this correlation.
  if [[ "$started_count" -lt 2 || "$completed_count" -lt 2 ]]; then
    err "Expected >=2 action_started and >=2 action_completed events, got started=${started_count} completed=${completed_count}"
    return 1
  fi
  log "action_started/action_completed pairs present: started=${started_count} completed=${completed_count}"

  local first_action_event_id
  first_action_event_id="$(echo "$CHAIN_BODY" | jq -r '[.events[]? | select(.kind == "action_started")][0].event_id')"
  if [[ -z "$first_action_event_id" || "$first_action_event_id" == "null" ]]; then
    err "Could not resolve an action_started event_id from the chain"
    return 1
  fi

  local combined body status action_index_type
  combined="$(api_status GET "/api/tracking/chains/${CORRELATION_ID}/events/${first_action_event_id}/payload")"
  status="$(api_status_code "$combined")"
  body="$(api_status_body "$combined")"
  if [[ "$status" != "200" ]]; then
    err "Payload fetch for action_started event ${first_action_event_id} returned status ${status}: ${body}"
    return 1
  fi
  action_index_type="$(echo "$body" | jq -r '.payload.actionIndex | type')"
  if [[ "$action_index_type" != "number" ]]; then
    err "Expected numeric actionIndex on action_started payload (event ${first_action_event_id}), got type ${action_index_type}: ${body}"
    return 1
  fi
  log "actionIndex present and numeric on action_started event ${first_action_event_id} (value=$(echo "$body" | jq -r '.payload.actionIndex'))"

  # Volume guard (SPEC.md constraint "Volume guard" + T05 "measure the
  # multiplier"): step events are emitted for EVERY run, so log the
  # multiplier vs the pre-step-events baseline of 3 events/run and assert
  # the run stays under the 100-step cap.
  local multiplier
  multiplier="$(awk -v n="$total_events" 'BEGIN { printf "%.1f", n / 3 }')"
  log "events per run: ${total_events} (multiplier vs pre-step-events baseline 3: x${multiplier})"
  if [[ "$total_events" -ge 100 ]]; then
    err "Event count ${total_events} for correlation ${CORRELATION_ID} reaches/exceeds the 100-step cap"
    return 1
  fi
  log "Event count ${total_events} within the 100-step cap"
}

stage_verify_payload() {
  # stage_verify_payload <nonce>
  #
  # Proves the durable payload capture round-trip end-to-end:
  #   1. Re-fetches the chain for CORRELATION_ID and picks the INGRESS event
  #      (kind == "webhook_received", the chain root) robustly by kind rather
  #      than assuming event_id == correlation_id.
  #   2. GETs its payload via the gateway as the same tenant-admin token that
  #      already passed the tracking:payload:read guard for stage 10's chain
  #      read, and asserts HTTP 200 with the payload body containing the
  #      happy-path nonce (the ingress payload carries the message text).
  #   3. GETs the payload of a fabricated, never-issued event id on the same
  #      correlation and asserts HTTP 404 (unknown event, not merely "no
  #      payload").
  local nonce="$1"
  log "Stage 11: verify payload round-trip for correlation ${CORRELATION_ID} (nonce ${nonce}, timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify payload"
    return 1
  fi

  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local ingress_event_id=""
  while (( $(date +%s) < deadline )); do
    # timeout -> retry
    ingress_event_id="$(api GET "/api/tracking/chains/${CORRELATION_ID}" \
      | jq -r '.events[]? | select(.kind == "webhook_received") | .event_id' | head -1)" || true
    [[ -n "$ingress_event_id" ]] && break
    sleep 3
  done
  if [[ -z "$ingress_event_id" ]]; then
    err "No webhook_received event found on chain ${CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s"
    return 1
  fi
  log "Resolved ingress event ${ingress_event_id} for correlation ${CORRELATION_ID}"

  local combined body status
  while (( $(date +%s) < deadline )); do
    # timeout -> retry
    combined="$(api_status GET "/api/tracking/chains/${CORRELATION_ID}/events/${ingress_event_id}/payload")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      if echo "$body" | jq -e --arg nonce "$nonce" \
          '(.payload // {} | tostring) | contains($nonce)' >/dev/null; then
        log "Ingress payload fetched (status 200) and contains nonce ${nonce}"
        break
      fi
      err "Ingress payload fetched but did not contain nonce ${nonce}: ${body}"
      return 1
    fi
    log "Payload endpoint returned status ${status} for ingress event; retrying"
    sleep 3
  done
  if [[ "$status" != "200" ]]; then
    err "Ingress payload never returned status 200 within ${CHAIN_TIMEOUT_S}s (last status ${status}): ${body}"
    return 1
  fi

  log "Fetching payload of fabricated unknown event id on correlation ${CORRELATION_ID} (expect 404)"
  local unknown_combined unknown_status unknown_body
  unknown_combined="$(api_status GET "/api/tracking/chains/${CORRELATION_ID}/events/00000000-0000-0000-0000-000000000000/payload")"
  unknown_status="$(api_status_code "$unknown_combined")"
  unknown_body="$(api_status_body "$unknown_combined")"
  if [[ "$unknown_status" != "404" ]]; then
    err "Expected 404 for fabricated unknown event id, got ${unknown_status}: ${unknown_body}"
    return 1
  fi
  log "Confirmed 404 for fabricated unknown event id"
}

stage_verify_run() {
  # Stage 12 (T07, manual-loops/run-view.md): GET /api/tracking/runs/:workflowId/:runId
  # for the happy-path run and assert the shape T01/to-run-response.ts
  # produces: summary.status == "completed", summary.steps_ok >= 1, a
  # channel-kind cast entry for the http channel, and at least one step
  # span with duration_ms > 0 (guaranteed once workflow-step-events has
  # landed, which stage 10b already confirmed on this same correlation).
  #
  # workflowId is the real Temporal id (colon-bearing, e.g.
  # "acme:e2e-http-log:sha256:...:id") — percent-encoded via jq's `@uri`
  # before being placed in the URL path, matching the gateway's
  # parseRunPathSegments contract (T02), which accepts either raw or
  # percent-encoded colons but this stage encodes to stay a well-formed URL.
  log "Stage 12: GET /api/tracking/runs/${HAPPY_PATH_WORKFLOW_ID}/${HAPPY_PATH_RUN_ID} (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$HAPPY_PATH_WORKFLOW_ID" || -z "$HAPPY_PATH_RUN_ID" ]]; then
    err "HAPPY_PATH_WORKFLOW_ID/HAPPY_PATH_RUN_ID empty — cannot verify run"
    return 1
  fi

  local encoded_wf encoded_run
  encoded_wf="$(jq -rn --arg v "$HAPPY_PATH_WORKFLOW_ID" '$v|@uri')"
  encoded_run="$(jq -rn --arg v "$HAPPY_PATH_RUN_ID" '$v|@uri')"

  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local combined body status
  while (( $(date +%s) < deadline )); do
    # timeout -> retry
    combined="$(api_status GET "/api/tracking/runs/${encoded_wf}/${encoded_run}")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      local status_ok steps_ok_ok channel_cast_ok nonzero_step_span_ok
      status_ok="$(echo "$body" | jq '.summary.status == "completed"')"
      steps_ok_ok="$(echo "$body" | jq '(.summary.steps_ok // 0) >= 1')"
      # Channel cast entry for the http channel — TAXONOMY.md Q5 renames
      # the `http` channel token to public tech value "http-generic".
      channel_cast_ok="$(echo "$body" | jq \
        '([.cast[]? | select(.kind == "channel" and (.name == "http-generic" or .id == "http-generic"))] | length) >= 1')"
      nonzero_step_span_ok="$(echo "$body" | jq '([.spans[]? | select(.duration_ms > 0)] | length) >= 1')"
      if [[ "$status_ok" == "true" && "$steps_ok_ok" == "true" \
            && "$channel_cast_ok" == "true" && "$nonzero_step_span_ok" == "true" ]]; then
        log "Run verified: status=completed=${status_ok} steps_ok>=1=${steps_ok_ok} http-channel-cast=${channel_cast_ok} nonzero-step-span=${nonzero_step_span_ok}"
        return 0
      fi
      log "Run not yet complete (status-completed=${status_ok} steps_ok>=1=${steps_ok_ok} http-channel-cast=${channel_cast_ok} nonzero-step-span=${nonzero_step_span_ok}); retrying"
    else
      log "Run endpoint returned status ${status}; retrying"
    fi
    sleep 3
  done
  err "Run assertions never satisfied for ${HAPPY_PATH_WORKFLOW_ID}/${HAPPY_PATH_RUN_ID} within ${CHAIN_TIMEOUT_S}s"
  err "Last response (status ${status}): ${body}"
  return 1
}

count_endpoint_orphans() {
  # T06: prints "<orphans>|<with_siblings>" on stdout — a plain SQL scan of
  # ALL tracking.tracked_events rows currently sitting in Postgres, split by
  # whether each 'endpoint_call_completed' row's correlation_id is shared
  # with at least one other tracked_events row (any kind) or not. This is
  # LOG-ONLY evidence-at-volume (no assertion on the absolute counts) — the
  # per-run correlation match is asserted separately by
  # stage_verify_endpoint_call_correlation. Not wrapped in a poll loop:
  # callers snapshot it as a point-in-time before/after comparison.
  kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc "
    select
      coalesce(count(*) filter (where sibling_count = 0), 0) || '|' || coalesce(count(*) filter (where sibling_count > 0), 0)
    from (
      select e.event_id,
        (select count(*) from tracking.tracked_events s
           where s.correlation_id = e.correlation_id and s.event_id <> e.event_id) as sibling_count
      from tracking.tracked_events e
      where e.kind = 'endpoint_call_completed'
    ) t;
  " 2>/dev/null
}

log_endpoint_orphans() {
  # log_endpoint_orphans <label>
  local label="$1"
  local counts orphans with_siblings
  counts="$(count_endpoint_orphans)" || counts=""
  if [[ -z "$counts" ]]; then
    warn "Could not query endpoint_call_completed orphan counts (${label}) — psql call failed or returned no rows"
    return 0
  fi
  orphans="${counts%%|*}"
  with_siblings="${counts##*|}"
  log "endpoint_call_completed orphan-correlation count (${label}): orphans=${orphans} with_siblings=${with_siblings}"
}

stage_verify_endpoint_call_correlation() {
  # Stage 13 (T06, manual-loops/connector-trace-linking.md): asserts stage 3's
  # 'probeEndpoint' endpointCall action produced an endpoint_call_completed
  # row in tracking.tracked_events sharing the happy-path run's
  # correlation_id — proves connector-runtime's endpointCall path inherits
  # the workflow's causal correlation live, not just in unit tests (T02
  # finding was that this event had never been produced by this suite at
  # all). Polled like the other async assertions (event is written
  # asynchronously by the ingester off a NATS subject).
  log "Stage 13: assert endpoint_call_completed row shares correlation_id ${CORRELATION_ID} (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify endpoint_call correlation"
    return 1
  fi
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local found=""
  while (( $(date +%s) < deadline )); do
    # kubectl/psql failure -> retry, same as the other poll loops treating a
    # transient error as "not yet" rather than a hard failure.
    # CORRELATION_ID is validated as a canonical UUID at capture time
    # (stage_capture_correlation_id), so interpolating it into this SQL is
    # safe. psql's -c invocation does not apply `-v`/`:'var'` substitution
    # (verified live: `-v corr=foo -c "select :'corr'"` errors at `:`), so
    # that parameterized form is not usable in this call shape.
    found="$(kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- \
      psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc \
      "select correlation_id from tracking.tracked_events where kind = 'endpoint_call_completed' and correlation_id = '${CORRELATION_ID}' limit 1;" \
      2>/dev/null)" || true
    [[ -n "$found" ]] && break
    sleep 3
  done
  if [[ -z "$found" ]]; then
    err "No endpoint_call_completed row found for correlation_id ${CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s"
    return 1
  fi
  log "Confirmed: endpoint_call_completed row in tracking.tracked_events shares correlation_id ${CORRELATION_ID}"
}

stage_verify_endpoint_events_gateway() {
  # Stage 14 (T06, manual-loops/connector-trace-linking.md): GET
  # /api/tracking/events?type=connector.endpoint_call.completed.v1
  # &resource=adapter/<adapterId>&limit=20 via the gateway (T03's connector
  # "Recent calls" read endpoint) and assert the response contains an event
  # whose correlation_id matches the happy-path run — proves the
  # gateway->ingester events-by-type/resource read path also carries the
  # correlation through end-to-end, not just the direct-SQL check in
  # stage 13.
  log "Stage 14: GET /api/tracking/events (type=connector.endpoint_call.completed.v1, resource=adapter/${ENDPOINT_ADAPTER_ID}) (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify endpoint events via gateway"
    return 1
  fi
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local combined body status match_ok
  while (( $(date +%s) < deadline )); do
    # timeout -> retry
    combined="$(api_status GET "/api/tracking/events?type=connector.endpoint_call.completed.v1&resource=adapter/${ENDPOINT_ADAPTER_ID}&limit=20")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      match_ok="$(echo "$body" | jq --arg cid "$CORRELATION_ID" \
        '([.events[]? | select(.correlation_id == $cid)] | length) >= 1')"
      if [[ "$match_ok" == "true" ]]; then
        log "Confirmed: gateway events endpoint returned an endpoint_call event with correlation_id ${CORRELATION_ID}"
        return 0
      fi
      log "Gateway events endpoint returned 200 but no matching correlation_id yet; retrying"
    else
      log "Gateway events endpoint returned status ${status}; retrying"
    fi
    sleep 3
  done
  err "Gateway events endpoint never returned an event with correlation_id ${CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s"
  err "Last response (status ${status}): ${body}"
  return 1
}

stage_verify_endpoint_scoped_events() {
  # Stage 14b (T04, manual-loops/connectors/endpoint-scoped-recent-calls.md):
  # the endpoint-SCOPED flavour of stage 14. GET
  # /api/tracking/events?type=connector.endpoint_call.completed.v1
  # &resource=adapter/<adapterId>&endpointId=<endpointId>&limit=20 via the
  # gateway (query params are forwarded verbatim by tracking.controller.ts's
  # getEvents) and assert:
  #   a. at least one row comes back;
  #   b. EVERY returned row's `payload_endpoint_id` equals the requested
  #      endpoint id — the filter must narrow, not merely decorate. Note the
  #      per-row field is `payload_endpoint_id` (build-events-query.ts's
  #      `envelope->'data'->'payload'->>'endpointId' AS payload_endpoint_id`),
  #      NOT the top-level `endpointId`, which is only the response's echo of
  #      the applied filter (to-events-response.ts);
  #   c. at least one of those rows carries THIS run's correlation_id, so the
  #      stage proves a round-trip of the happy-path run's own scoped call
  #      rather than passing on residue from an earlier run;
  #   d. a fabricated, never-issued endpointId returns HTTP 200 with an EMPTY
  #      `events` array — `GET /events` is a filtered LIST, not a lookup, and
  #      handle-events-request.ts never 404s on an unmatched filter.
  log "Stage 14b: GET /api/tracking/events (type=connector.endpoint_call.completed.v1, resource=adapter/${ENDPOINT_ADAPTER_ID}, endpointId=${ENDPOINT_ID}) (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify endpoint-scoped events via gateway"
    return 1
  fi
  if [[ -z "$ENDPOINT_ID" ]]; then
    err "ENDPOINT_ID is empty — stage_resolve_endpoint_id (stage 1b) must run first"
    return 1
  fi
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local combined body status count_returned all_scoped_ok correlation_ok
  while (( $(date +%s) < deadline )); do
    # timeout -> retry, same convention as stage 14
    combined="$(api_status GET "/api/tracking/events?type=connector.endpoint_call.completed.v1&resource=adapter/${ENDPOINT_ADAPTER_ID}&endpointId=${ENDPOINT_ID}&limit=20")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      count_returned="$(echo "$body" | jq '[.events[]?] | length')"
      all_scoped_ok="$(echo "$body" | jq --arg eid "$ENDPOINT_ID" \
        '[.events[]? | select(.payload_endpoint_id != $eid)] | length == 0')"
      correlation_ok="$(echo "$body" | jq --arg cid "$CORRELATION_ID" \
        '([.events[]? | select(.correlation_id == $cid)] | length) >= 1')"
      if [[ "$count_returned" -ge 1 && "$all_scoped_ok" == "true" && "$correlation_ok" == "true" ]]; then
        log "Endpoint-scoped events verified: rows=${count_returned} all-rows-match-endpointId=${all_scoped_ok} happy-path-correlation-present=${correlation_ok}"
        break
      fi
      log "Endpoint-scoped events not yet satisfied (rows=${count_returned} all-rows-match-endpointId=${all_scoped_ok} happy-path-correlation-present=${correlation_ok}); retrying"
    else
      log "Gateway events endpoint (endpoint-scoped) returned status ${status}; retrying"
    fi
    sleep 3
  done
  if [[ "$status" != "200" || "${count_returned:-0}" -lt 1 || "$all_scoped_ok" != "true" || "$correlation_ok" != "true" ]]; then
    err "Endpoint-scoped events assertions never satisfied for adapter ${ENDPOINT_ADAPTER_ID} endpoint ${ENDPOINT_ID} within ${CHAIN_TIMEOUT_S}s"
    err "Last response (status ${status}): ${body}"
    return 1
  fi

  log "Stage 14b: GET the same feed with a fabricated nonexistent endpointId (expect 200 + empty events)"
  local unknown_combined unknown_status unknown_body unknown_count unknown_echo
  unknown_combined="$(api_status GET "/api/tracking/events?type=connector.endpoint_call.completed.v1&resource=adapter/${ENDPOINT_ADAPTER_ID}&endpointId=00000000-0000-0000-0000-000000000000&limit=20")"
  unknown_status="$(api_status_code "$unknown_combined")"
  unknown_body="$(api_status_body "$unknown_combined")"
  if [[ "$unknown_status" != "200" ]]; then
    err "Expected 200 (filtered list, not a lookup) for a nonexistent endpointId, got ${unknown_status}: ${unknown_body}"
    return 1
  fi
  unknown_count="$(echo "$unknown_body" | jq '[.events[]?] | length')"
  if [[ "$unknown_count" -ne 0 ]]; then
    err "Expected an EMPTY events array for a nonexistent endpointId, got ${unknown_count} row(s): ${unknown_body}"
    return 1
  fi
  unknown_echo="$(echo "$unknown_body" | jq -r '.endpointId // "null"')"
  log "Confirmed: nonexistent endpointId returned 200 with 0 events (response echoes endpointId=${unknown_echo})"
}

stage_verify_service_call_correlation() {
  # Stage 15 (T12, manual-loops/connectors/connection-call-inspector.md):
  # asserts stage 3's 'probeService' serviceCall action produced an
  # endpoint_call_completed row in tracking.tracked_events with resource
  # 'service/<slug>' sharing the happy-path run's correlation_id — proves
  # connector-runtime's serviceCall path (T01's documented gap) inherits the
  # workflow's causal correlation live, mirroring stage 13's endpointCall
  # assertion. Polled like the other async assertions (event is written
  # asynchronously by the ingester off a NATS subject).
  log "Stage 15: assert endpoint_call_completed (resource service/${SERVICE_CALL_SERVICE_SLUG}) row shares correlation_id ${CORRELATION_ID} (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify serviceCall correlation"
    return 1
  fi
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local found=""
  while (( $(date +%s) < deadline )); do
    # kubectl/psql failure -> retry, same as stage_verify_endpoint_call_correlation.
    found="$(kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- \
      psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc \
      "select correlation_id from tracking.tracked_events where kind = 'endpoint_call_completed' and envelope->>'resource' = 'service/${SERVICE_CALL_SERVICE_SLUG}' and correlation_id = '${CORRELATION_ID}' limit 1;" \
      2>/dev/null)" || true
    [[ -n "$found" ]] && break
    sleep 3
  done
  if [[ -z "$found" ]]; then
    err "No endpoint_call_completed row (resource service/${SERVICE_CALL_SERVICE_SLUG}) found for correlation_id ${CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s"
    return 1
  fi
  log "Confirmed: endpoint_call_completed row (resource service/${SERVICE_CALL_SERVICE_SLUG}) in tracking.tracked_events shares correlation_id ${CORRELATION_ID}"
}

stage_verify_service_call_events_gateway() {
  # Stage 16 (T12): GET
  # /api/tracking/events?type=connector.endpoint_call.completed.v1
  # &resource=service/<slug>&limit=20 via the gateway and assert the
  # response contains an event whose correlation_id matches the happy-path
  # run — proves the gateway->ingester events-by-type/resource read path
  # also carries serviceCall's correlation through, mirroring stage 14 for
  # endpointCall. Captures the matched event_id into SERVICE_CALL_EVENT_ID
  # for stage_verify_service_call_payload (stage 17).
  log "Stage 16: GET /api/tracking/events (type=connector.endpoint_call.completed.v1, resource=service/${SERVICE_CALL_SERVICE_SLUG}) (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify serviceCall events via gateway"
    return 1
  fi
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local combined body status
  while (( $(date +%s) < deadline )); do
    # timeout -> retry
    combined="$(api_status GET "/api/tracking/events?type=connector.endpoint_call.completed.v1&resource=service/${SERVICE_CALL_SERVICE_SLUG}&limit=20")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      SERVICE_CALL_EVENT_ID="$(echo "$body" | jq -r --arg cid "$CORRELATION_ID" \
        '[.events[]? | select(.correlation_id == $cid)][0].event_id // empty')"
      if [[ -n "$SERVICE_CALL_EVENT_ID" ]]; then
        log "Confirmed: gateway events endpoint returned a serviceCall event with correlation_id ${CORRELATION_ID} (event_id=${SERVICE_CALL_EVENT_ID})"
        return 0
      fi
      log "Gateway events endpoint returned 200 but no matching serviceCall correlation_id yet; retrying"
    else
      log "Gateway events endpoint returned status ${status}; retrying"
    fi
    sleep 3
  done
  err "Gateway events endpoint never returned a serviceCall event with correlation_id ${CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s"
  err "Last response (status ${status}): ${body}"
  return 1
}

stage_verify_service_call_payload() {
  # stage_verify_service_call_payload <nonce>
  #
  # Stage 17 (T12): GET /api/tracking/chains/:cid/events/:eid/payload for
  # the serviceCall event captured by stage 16, as the same authenticated
  # tenant-admin token every other stage uses, and assert HTTP 200 with the
  # payload containing the run's nonce. The manifest's 'probeService' action
  # embeds `{{request.text}}` (the webhook nonce) into `args.data.nonce`
  # (see e2e_manifest_body), so the captured requestBody round-trips it
  # unredacted — same round-trip proof pattern as stage_verify_payload
  # (stage 11) for the webhook ingress event.
  local nonce="$1"
  log "Stage 17: verify serviceCall payload round-trip for event ${SERVICE_CALL_EVENT_ID} (nonce ${nonce}, timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$SERVICE_CALL_EVENT_ID" ]]; then
    err "SERVICE_CALL_EVENT_ID is empty — stage_verify_service_call_events_gateway (stage 16) must run first"
    return 1
  fi
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify serviceCall payload"
    return 1
  fi

  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local combined body status
  while (( $(date +%s) < deadline )); do
    # timeout -> retry
    combined="$(api_status GET "/api/tracking/chains/${CORRELATION_ID}/events/${SERVICE_CALL_EVENT_ID}/payload")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      if echo "$body" | jq -e --arg nonce "$nonce" \
          '(.payload // {} | tostring) | contains($nonce)' >/dev/null; then
        log "serviceCall payload fetched (status 200) and contains nonce ${nonce}"
        return 0
      fi
      err "serviceCall payload fetched but did not contain nonce ${nonce}: ${body}"
      return 1
    fi
    log "Payload endpoint returned status ${status} for serviceCall event; retrying"
    sleep 3
  done
  err "serviceCall payload never returned status 200 within ${CHAIN_TIMEOUT_S}s (last status ${status}): ${body}"
  return 1
}

main() {
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  stage_login
  # Must precede stage_resolve_endpoint_id — provisions/resolves the
  # pokeapi connector + sample-echo service this run needs, replacing the
  # old hardcoded-id-that-goes-stale-after-a-reset approach.
  stage_ensure_prerequisites
  # T04: must precede stage_apply_manifest — the manifest body interpolates
  # the endpoint id this stage resolves off the live adapter.
  stage_resolve_endpoint_id
  stage_apply_manifest
  stage_fetch_channel_secret
  stage_ensure_agent_published
  log_endpoint_orphans "before this run"
  stage_send_message "$NONCE"
  stage_verify_execution "$NONCE"
  # Let the happy-path run finish ALL its actions (jsFunction + both
  # endpointCall probes + serviceCall probe) before disabling, so stage 6's
  # terminate can't kill it mid-flight.
  stage_wait_execution_completed "$NONCE"
  stage_disable_workflow
  local ids_before_disabled_send
  ids_before_disabled_send="$(stage_capture_execution_ids)"
  stage_send_message "$NONCE_DISABLED"
  stage_verify_no_execution "$NONCE_DISABLED" "$ids_before_disabled_send"
  stage_enable_workflow
  stage_send_message "$NONCE_REENABLED"
  stage_verify_execution "$NONCE_REENABLED"
  stage_capture_correlation_id "$NONCE"
  stage_verify_chain
  stage_verify_step_events
  stage_verify_payload "$NONCE"
  stage_verify_run
  stage_verify_endpoint_call_correlation
  stage_verify_endpoint_events_gateway
  # T04 (manual-loops/connectors/endpoint-scoped-recent-calls.md): the same
  # feed narrowed by `endpointId`, fed by the 'probeEndpointScoped' action.
  stage_verify_endpoint_scoped_events
  # T12 (manual-loops/connectors/connection-call-inspector.md): serviceCall
  # capture round-trip — same three-stage shape as the endpointCall
  # assertions above (direct SQL correlation, gateway events read,
  # guarded payload fetch). MCP and standalone-LLM emission paths (T03/T04
  # of the same SPEC) are NOT covered here: no MCP server or standalone-LLM
  # job fixture exists in this dev e2e today, so those two paths stay
  # covered by service-level unit tests only — adding cluster fixtures for
  # them is out of scope for T12.
  stage_verify_service_call_correlation
  stage_verify_service_call_events_gateway
  stage_verify_service_call_payload "$NONCE"
  # COMPOSITION COVERAGE: runs last — it needs CORRELATION_ID (stage 9) and
  # reads the same chain the stages above already proved is complete.
  stage_verify_conditional "$NONCE"
  # EGRESS COVERAGE: last, for the same reason as the stage above — it reads
  # the happy-path correlation the earlier stages established.
  stage_verify_egress_sent "$NONCE"
  # FAN-OUT COVERAGE: last, same reason as the two stages above — reads the
  # happy-path correlation the earlier stages established.
  stage_verify_fan_out
  log_endpoint_orphans "after this run"
  log "E2E http → workflow → jsFunction chain + toggle scenario + tracking chain + step events + payload round-trip + run view + endpointCall correlation round-trip + endpoint-scoped events round-trip + serviceCall correlation round-trip verified (nonces ${NONCE}, ${NONCE_DISABLED}, ${NONCE_REENABLED}; correlation ${CORRELATION_ID})"
}

main "$@"
