#!/usr/bin/env bun
/**
 * manifest-showcase-driver.ts — T09 (manual-loops/declarative-provisioning.md)
 * + T1 coverage-maximization pass (this task) "full showcase" manifest driven
 * through the REAL SDK (`sdk/src/index.ts`, imported directly by relative
 * path — the package ships no build output in this workspace and `bun`
 * resolves the `.js`-suffixed relative imports the SDK's own source uses onto
 * their `.ts` files natively, exactly like every other file inside `sdk/src`
 * importing its siblings).
 *
 * Invoked by `scripts/e2e/manifest-apply.sh` (never run standalone in CI) —
 * the bash script owns cluster reachability checks, trap-guarded teardown of
 * every downstream resource this driver creates, and the tracking-ingester
 * Postgres assertions (this driver has no cluster-internal DB access). This
 * file owns exactly the SDK-facing round trips:
 *
 * ROUND 1 — the full showcase manifest (`kind: IntegrationManifest`), now
 * covering EVERY resource kind the manifest schema supports except
 * `services`/`knowledgeBases[].source.type: url` (out of scope — see below):
 *   - a `channel` (secretRef -> secret A),
 *   - a `connector` with `auth` (bearer, secretRef -> secret C), `endpoints`
 *     (one cached GET) and `tags: ["llm"]` (required so the agent's
 *     `model_config.llm.connectorId` reference below resolves through
 *     agent-ai-service's credential resolver, which REJECTS an LLM connector
 *     lacking the `llm` tag),
 *   - an `mcpServer` with a `headers` entry using `{ secretRef }` (secret D),
 *   - a `skill` (minimal — no `files[]`, kept cheap),
 *   - a `systemVariable` (plain, non-secret config value),
 *   - an `agent` (knowledgeBaseRefs -> the KB, `enabledMcpServerRefs` /
 *     `enabledMcpTools` / `toolDescriptionOverrides` -> the mcpServer above,
 *     `profile.model_config.llm.connectorId` -> the connector above, a
 *     SCALAR symbolic-ref substitution),
 *   - a `knowledgeBase` (inline document),
 *   - a `workflow` wiring channel + agent + connector together: `trigger`
 *     pins `config.accountIds` to the channel (an ARRAY symbolic-ref
 *     substitution, `channelRef`), and an `endpointCall` action's `adapterId`
 *     targets the connector (a SCALAR symbolic-ref substitution,
 *     `connectorRef`).
 *   put -> plan (all-create, zero preconditions) -> apply (appliedCount=7) ->
 *   plan again (all-noop) -> apply again (no-op, proving substitution
 *   idempotence for every kind that carries one) -> a post-apply fetch of the
 *   created workflow (done by the bash caller, which alone has the
 *   `workflow_curl` wiring) asserts the STORED definition carries real UUIDs
 *   for `accountIds`/`adapterId`, never the symbolic `channelRef`/
 *   `connectorRef` strings.
 *
 * ROUND 2 — a mini `kind: LibraryManifest` (`e2e-lib-*` names) with ONE
 * connector and nothing else — the waiver `checkAtLeastOneLibraryResource`
 * exists to test (no channel/workflow required for a LibraryManifest):
 *   put -> plan (create 1) -> apply (appliedCount=1) -> apply again (no-op).
 *
 * ROUND 3 — three PLAN-ONLY negative tests (a SEPARATE throwaway manifest,
 * `e2e-neg-*`, so the main showcase manifest's converged state above is never
 * touched): `unallowlisted_symbolic_ref`, `mismatched_symbolic_ref`,
 * `invalid_array_substitution_shape`. All three fail-loud kinds only surface
 * at APPLY time (`substitute-symbolic-refs.ts` is invoked exclusively from
 * `apply-manifest.ts`, never from the read-only plan builder — verified by
 * grepping the plan module for `substituteSymbolicRefs`/
 * `buildSubstitutedResource`: zero hits), so each round is plan() (always
 * succeeds, all-create) -> apply() (expected to THROW `ConflictError` with
 * the exact `error.details.body.error.failure.kind` asserted). The
 * throwaway manifest's channel + connector satisfy the structural minimum
 * (>=1 inbound channel, >=1 process) and are created on round 1's apply
 * attempt (before the failing workflow is ever reached — RESOURCE_KIND_ORDER
 * ranks "workflow" last); rounds 2 and 3 reuse the SAME channel/connector
 * (they come back `noop`), so no NEW resource is ever created past the first
 * round's structural pair. The failing workflow itself is asserted ABSENT
 * from workflow-service NOT by this driver (which has no workflow-service
 * wiring) but by the bash caller's stage 8c: after the driver returns, it
 * looks `negativeManifest.workflowName` up via `workflow_curl GET /workflows`
 * and FAILS the script if any workflow with that name exists.
 *
 * OUT OF SCOPE (by this task's explicit instruction, not an oversight):
 *   - `services[]` (hosted services / registry routes) — a heavier stage
 *     (Knative reconciliation) this task's "no heavy stages" constraint
 *     excludes.
 *   - `route_collision` preconditions — only reachable with `services[]`.
 *   - `knowledgeBases[].documents[].source.type: "url"` — network-fetched KB
 *     ingestion, likewise heavier than this task's scope.
 *
 * DEFERRAL (STALE, corrected by this task): the T09-era header here used to
 * say a connector's `secretRef` fails apply with `secret_not_resolvable`
 * because "connector auth wiring through the broker is a follow-up beyond
 * T05's scope". Verified FALSE against the current `connectors-writer.ts` /
 * `mcp-servers-writer.ts` / `platform-resource-writers.provider.ts`: both
 * writers are wired with a live `BrokerSecretResolver` in production DI
 * (`apply.module.ts`), and `secret-consumer-policy.ts`'s
 * `provisioning-service-apply-engine` identity is authorized for EVERY
 * `ResourceKind`. So THIS revision of the showcase manifest exercises full
 * secret-bearing `auth`/`headers` resolution for both connector and
 * mcpServer.
 *
 * CI note: the channel uses `type: "http"` rather than `telegram` — real
 * Telegram bot credentials do not exist in the dev cluster, and `http` is
 * the exact fallback this task's SPEC section calls for. The resource is
 * still NAMED `e2e-telegram-*` so the showcase narrative reads as intended.
 *
 * Exits 0 with a single JSON summary line on stdout (parsed by the bash
 * caller for teardown externalIds + tracking-query correlation values).
 * Exits 1 with a diagnostic on stderr for any failed assertion — never
 * throws an uncaught exception past `main()`. Every secret VALUE (A/B/C/D)
 * is NEVER logged, NEVER included in the JSON summary, and NEVER printed —
 * only names/owners/verdicts are.
 *
 * T03 (agent-mcp-tool-naming.md) — DRIVER SELF-CLEANUP (ruled: driver
 * self-cleanup over a bash prefix/age sweep — see that SPEC's Progress
 * section). The division of responsibility this file's header used to
 * describe ("bash owns teardown, this file owns SDK round trips only") is
 * the ROOT CAUSE of the incident that motivated T03: a live `e2e-mcp-*`
 * `mcp_servers` row survived a run that died before this file ever printed
 * its JSON summary, because teardown was 100% summary-dependent. This file
 * now ALSO tracks every round-1/round-2 resource it successfully creates
 * (`trackForCleanup`, right after each externalId is known) and, on ANY exit
 * path that is not "successful JSON printed" — a thrown assertion
 * (`fail()`), an unexpected SDK error, `SIGINT`/`SIGTERM` — deletes every
 * tracked resource itself (`selfCleanup`, PRIORITY order — mcpServer
 * FIRST, see `selfCleanup`'s own comment) BEFORE the
 * process exits non-zero. This is defense-in-depth, not a replacement:
 * `manifest-apply.sh`'s own JSON-driven teardown AND its nonce-suffix sweep
 * (`sweep_by_name`, added in a prior fix attempt) stay exactly as they are —
 * a hard kill (`SIGKILL`, OOM) bypasses even this file's own signal
 * handlers, so the bash-side sweep remains the only recovery path for that
 * case (see `E2E_DIE_AFTER_APPLY` below, which still simulates exactly that
 * un-recoverable-by-JS scenario on purpose). `E2E_SIMULATE_SOFT_FAILURE_AFTER_APPLY`
 * (new) simulates the case THIS file's self-cleanup DOES recover from: a
 * thrown error mid-round, after resources exist but before the JSON summary.
 */

import { randomUUID } from "node:crypto";
import { ConflictError, createClient } from "../../sdk/src/index.js";

// ---------------------------------------------------------------------------
// Env / config — mirrors the E2E_* convention every other e2e script uses.
// ---------------------------------------------------------------------------

const TENANT = process.env.E2E_TENANT ?? "acme";
const EMAIL = process.env.E2E_EMAIL ?? "yclawd@demo.io";
const PASSWORD = process.env.E2E_PASSWORD ?? "admin123";

const GATEWAY_HOST =
  process.env.E2E_GATEWAY_HOST ?? "api-gateway.platform-services-dev.dev.local";
// Default empty string disables the resolve-IP rewrite (e.g. an in-cluster
// runner that can resolve *.dev.local itself); "127.0.0.1" (the default,
// matching every curl-based e2e script's E2E_RESOLVE_IP) assumes a
// port-forward/ingress tunnel bound to localhost.
const RESOLVE_IP = process.env.E2E_RESOLVE_IP ?? "127.0.0.1";
const GATEWAY_BASE_URL =
  process.env.E2E_GATEWAY_URL ??
  (RESOLVE_IP ? `http://${RESOLVE_IP}` : `http://${GATEWAY_HOST}`);

const PROVISIONING_HOST =
  process.env.E2E_PROVISIONING_HOST ??
  "provisioning-service.platform-services-dev.dev.local";
const PROVISIONING_BASE_URL =
  process.env.E2E_PROVISIONING_URL ??
  (RESOLVE_IP ? `http://${RESOLVE_IP}` : `http://${PROVISIONING_HOST}`);

const CONNECTOR_ADMIN_HEALTH_URL =
  process.env.E2E_CONNECTOR_ADMIN_BASE_URL ??
  "http://connector-admin-api.platform-services-dev.svc.cluster.local";

const NONCE =
  process.env.E2E_NONCE ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ---------------------------------------------------------------------------
// Logging — verbose, stderr-only (stdout is reserved for the final JSON line
// the bash caller parses with `jq`).
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.error(`[showcase-driver] ${msg}`);
}

/**
 * Marks an assertion failure. Used to THROW (never `process.exit` directly)
 * so every failure path — including this one — flows through the SAME
 * `main().catch()` handler below, which runs `selfCleanup()` before the
 * process actually exits (T03: driver self-cleanup). A `process.exit(1)`
 * here would skip `selfCleanup()` entirely, reintroducing exactly the
 * residue bug T03 fixes.
 */
class ShowcaseAssertionError extends Error {}

function fail(msg: string): never {
  console.error(`[showcase-driver] ASSERTION FAILED: ${msg}`);
  throw new ShowcaseAssertionError(msg);
}

// ---------------------------------------------------------------------------
// T03 driver self-cleanup — tracks every resource this driver itself
// creates so it can tear them down from its OWN exit path, independent of
// whether the process ever reaches the final JSON-summary print or whether
// `manifest-apply.sh`'s trap/sweep ever runs. See this file's header
// comment for the full rationale and the division-of-responsibility
// recheck.
// ---------------------------------------------------------------------------

interface TrackedResource {
  readonly kind: string;
  readonly name: string;
  readonly remove: () => Promise<void>;
}

const trackedResources: TrackedResource[] = [];

/**
 * Registers a successfully-created resource for defense-in-depth teardown.
 * No-op (with a log line) if `externalId` is missing — a resource whose id
 * was never captured can't be targeted for deletion here; it stays covered
 * by `manifest-apply.sh`'s name-resolution fallback / nonce sweep only.
 */
function trackForCleanup(
  kind: string,
  name: string,
  externalId: string | undefined,
  remove: (id: string) => Promise<void>
): void {
  if (!externalId) {
    log(
      `self-cleanup tracking SKIPPED for ${kind} '${name}': no externalId captured`
    );
    return;
  }
  trackedResources.push({
    kind,
    name,
    remove: () => remove(externalId),
  });
  log(
    `self-cleanup tracking: ${kind} '${name}' externalId='${externalId}' registered (defense-in-depth, independent of the JSON summary)`
  );
}

/**
 * Deletes every tracked resource in insertion/priority order — mcpServer
 * first (registered first, see the round-1 `trackForCleanup` call
 * sequence), NOT reverse-creation/LIFO order. Called from
 * every non-success exit path (see `main().catch()` and the signal handlers
 * below) — never from the success path, where `manifest-apply.sh`'s
 * JSON-driven teardown (using this driver's own summary) remains the owner,
 * exactly as before T03. Each deletion is best-effort: one failure never
 * blocks the rest, and any residual failure still falls back to
 * `manifest-apply.sh`'s nonce-suffix sweep (kept as the second line of
 * defense per this task's explicit instruction).
 */
async function selfCleanup(reason: string): Promise<void> {
  if (trackedResources.length === 0) {
    log(`self-cleanup (${reason}): nothing tracked yet, nothing to remove`);
    return;
  }
  log(
    `self-cleanup (${reason}): removing ${String(trackedResources.length)} driver-tracked resource(s) so residue cannot outlive this run`
  );
  // Explicit PRIORITY order, NOT reverse-creation/LIFO order: `mcpServer` is
  // registered FIRST (see the round-1 `trackForCleanup` call sequence
  // above) specifically so it is iterated — and removed — FIRST here. A
  // reverse/LIFO loop would remove it LAST, which is backwards: the
  // mcpServer is the one resource kind whose residue actively harms OTHER
  // tenant traffic while it lives (incident root cause 2 — an
  // enabled+active stray MCP server auto-connects for every agent), so it
  // must be the highest-priority removal, not the lowest.
  for (const resource of trackedResources) {
    try {
      await resource.remove();
      log(
        `self-cleanup (${reason}): removed ${resource.kind} '${resource.name}'`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[showcase-driver] self-cleanup (${reason}): FAILED to remove ${resource.kind} '${resource.name}': ${message} — manifest-apply.sh's own teardown/sweep remains the second line of defense`
      );
    }
  }
}

/** Injects a `Host` header on every request — the fetch-level equivalent of curl's `--resolve` + `-H "Host: ..."` pairing every other e2e script uses. */
function withHostHeader(hostHeader: string): typeof fetch {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Host", hostHeader);
    return fetch(input, { ...init, headers });
  };
}

// ---------------------------------------------------------------------------
// Manifest resource names — e2e-prefixed, account-scoped, nonce-suffixed.
// ---------------------------------------------------------------------------

const MANIFEST_NAME = `e2e-manifest-showcase-${NONCE}`;
const CHANNEL_NAME = `e2e-telegram-${NONCE}`;
const CONNECTOR_NAME = `e2e-connector-${NONCE}`;
const MCP_SERVER_NAME = `e2e-mcp-${NONCE}`;
const SKILL_NAME = `e2e-skill-${NONCE}`;
const SYSVAR_NAME = `e2e-sysvar-${NONCE}`;
const AGENT_NAME = `e2e-agent-${NONCE}`;
const KB_NAME = `e2e-kb-showcase-${NONCE}`;
const WORKFLOW_NAME = `e2e-flow-showcase-${NONCE}`;
const SECRET_A_NAME = `e2e-secret-a-${NONCE}`;
const SECRET_B_NAME = `e2e-secret-b-${NONCE}`;
// Secret B is bound to a DIFFERENT owner than the showcase channel — an
// otherwise-inert slug, never created as a real manifest resource. It only
// exists so the negative broker test has a genuinely MISMATCHED binding to
// probe (secret B is real, just not bound to the channel the mismatched
// call claims to act for).
const SECRET_B_OWNER = `e2e-other-owner-${NONCE}`;
// Coverage-maximization additions (this task): secret C binds the
// connector's `auth.bearerToken`, secret D binds one mcpServer `headers`
// entry — both scoped to their OWNING resource's own name, exactly like
// secret A's channel binding.
const SECRET_C_NAME = `e2e-secret-c-${NONCE}`;
const SECRET_D_NAME = `e2e-secret-d-${NONCE}`;

// ROUND 2 — mini LibraryManifest (one connector, no channel/workflow).
const LIB_MANIFEST_NAME = `e2e-manifest-lib-${NONCE}`;
const LIB_CONNECTOR_NAME = `e2e-lib-connector-${NONCE}`;

// ROUND 3 — throwaway negative-test manifest, kept entirely separate from
// MANIFEST_NAME so the main showcase manifest's converged state is never
// touched by a deliberately-broken revision.
const NEG_MANIFEST_NAME = `e2e-manifest-neg-${NONCE}`;
const NEG_CHANNEL_NAME = `e2e-neg-channel-${NONCE}`;
const NEG_CONNECTOR_NAME = `e2e-neg-connector-${NONCE}`;
const NEG_WORKFLOW_NAME = `e2e-neg-flow-${NONCE}`;

// Never logged, never returned in the JSON summary — literal values only
// travel inside the four `secrets.set()` request bodies below.
const SECRET_A_VALUE = `e2e-secret-a-value-${randomUUID()}`;
const SECRET_B_VALUE = `e2e-secret-b-value-${randomUUID()}`;
const SECRET_C_VALUE = `e2e-secret-c-value-${randomUUID()}`;
const SECRET_D_VALUE = `e2e-secret-d-value-${randomUUID()}`;

function buildManifest(): Record<string, unknown> {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: MANIFEST_NAME },
    spec: {
      channels: [
        {
          name: CHANNEL_NAME,
          // CI fallback: real Telegram bot credentials don't exist in dev —
          // see this file's header comment.
          type: "http",
          direction: "inbound",
          secretRef: SECRET_A_NAME,
        },
      ],
      connectors: [
        {
          name: CONNECTOR_NAME,
          type: "http",
          config: { baseUrl: CONNECTOR_ADMIN_HEALTH_URL, context: "external" },
          // `auth` (T01 decision 3, secretRef-ONLY nested targeting) — full
          // broker round trip, see this file's header DEFERRAL correction.
          auth: {
            authType: "bearer",
            bearerToken: { secretRef: SECRET_C_NAME },
          },
          // One cached GET endpoint (T02 gap 2 + T06 gap 2 cache).
          endpoints: [
            {
              label: "connector-admin health",
              method: "GET",
              path: "/health",
              cache: {
                enabled: true,
                ttlSeconds: 60,
                methods: ["GET"],
                keyQueryParams: "all",
                keyBody: false,
              },
            },
          ],
          // REQUIRED so agent-admin's credential resolver accepts this
          // connector as the agent's `model_config.llm.connectorId` target
          // below (an LLM connector without the `llm` tag is rejected).
          tags: ["llm"],
        },
      ],
      // T06 gap 6 — placed before agents (schema section order), one
      // `headers` entry resolved through the broker (secret D).
      mcpServers: [
        {
          name: MCP_SERVER_NAME,
          description: "e2e showcase MCP server (T1 coverage pass)",
          transport_type: "http",
          url: "http://mcp-server-placeholder.platform-services-dev.svc.cluster.local",
          headers: {
            "X-E2E-Secret-Header": { secretRef: SECRET_D_NAME },
          },
          enabled: true,
          scope: "external",
        },
      ],
      // T01 (gaps-3, workstream a) — minimal skill, no `files[]` (kept cheap
      // per this task's "same round-trip count" instruction).
      skills: [
        {
          name: SKILL_NAME,
          description: "e2e showcase skill (T1 coverage pass)",
          system_prompt:
            "You are an e2e showcase skill. Never used for real traffic.",
        },
      ],
      agents: [
        {
          name: AGENT_NAME,
          profile: {
            description: "e2e showcase agent (T09 declarative-provisioning)",
            system_prompt:
              "You are an e2e showcase agent. Never used for real traffic.",
            // `model_config.llm.connectorId` — SCALAR symbolic-ref
            // substitution (`connectorId` allowlist entry,
            // `substitution-allowlist.ts`), walked via the PRE-EXISTING
            // agent-`profile` tree root (`build-substituted-resource.ts`).
            model_config: {
              llm: {
                connectorId: { connectorRef: CONNECTOR_NAME },
              },
            },
          },
          knowledgeBaseRefs: [KB_NAME],
          // T06 gap 6 — plain manifest NAMES, deliberately NOT symbolic-ref
          // objects (see `agentSchema.enabledMcpServerRefs`'s own header
          // comment: agent-ai-service's `enabled_mcp_servers` is keyed by
          // NAME, never substituted to an id).
          enabledMcpServerRefs: [MCP_SERVER_NAME],
          // T04 (gaps-2) gap 4 — per-tool allowlist, `null` = all tools
          // enabled for this server, keyed by the SAME plain NAME.
          enabledMcpTools: { [MCP_SERVER_NAME]: null },
          // T04 (gaps-2) gap 4 — one override, `<serverName>__<toolName>` key
          // shape (validated prefix only, free-form tool-name suffix).
          // agent-mcp-tool-naming.md T01, Option B — was a colon-joined key
          // before T01; `__` is the current separator.
          toolDescriptionOverrides: {
            [`${MCP_SERVER_NAME}__showcase-tool`]:
              "e2e showcase tool description override",
          },
        },
      ],
      knowledgeBases: [
        {
          name: KB_NAME,
          documents: [
            {
              name: "faq",
              source: {
                type: "inline",
                content: `e2e showcase KB document — ${NONCE}`,
              },
            },
          ],
        },
      ],
      services: [],
      // T04 (gaps) gap 4 — leaf node, plain non-secret config value.
      systemVariables: [
        {
          name: SYSVAR_NAME,
          type: "string",
          value: `e2e showcase system variable value — ${NONCE}`,
          label: "e2e showcase system variable",
        },
      ],
      workflows: [
        {
          name: WORKFLOW_NAME,
          definition: {
            application: MANIFEST_NAME,
            actions: [
              {
                activity: "jsFunction",
                name: "log-e2e-showcase",
                args: { code: "(ctx) => ({ ok: true })" },
              },
              // `endpointCall`'s `adapterId` — SCALAR symbolic-ref
              // substitution (`connectorRef`, `substitution-allowlist.ts`),
              // mirroring `integrations/channels/http-fanout-telegram/
              // manifest.yaml`'s own `adapterId: { connectorRef: ... }`
              // shape exactly.
              {
                activity: "endpointCall",
                name: "call-connector-health",
                args: {
                  method: "GET",
                  url: "/health",
                  adapterId: { connectorRef: CONNECTOR_NAME },
                },
              },
            ],
            // `trigger.config.accountIds` — ARRAY symbolic-ref substitution
            // (`channelRef`, `array-substitution-allowlist.ts`), mirroring
            // `integrations/channels/telegram-transform-reply/manifest.yaml`'s
            // own pinned-trigger shape exactly (channels/providers use this
            // manifest's own "http" channel type, matching
            // `http-fanout-telegram/manifest.yaml`'s http-channel trigger).
            trigger: {
              type: "message_received",
              mode: "shared",
              config: {
                channels: ["http"],
                providers: ["http"],
                accountIds: [{ channelRef: CHANNEL_NAME }],
              },
            },
            // Wiring: references the channel + agent this manifest also
            // declares — walked by validate-structural-rules.ts's
            // collectSymbolicRefs, resolved by NAME (not substituted; kept
            // from the original T09 driver for the agent/channel wiring
            // narrative — connectorRef/channelRef ABOVE are the ones that DO
            // get substituted to real ids).
            variables: { channelRef: CHANNEL_NAME, agentRef: AGENT_NAME },
          },
        },
      ],
      secrets: [
        {
          name: SECRET_A_NAME,
          scope: { kind: "channel", owner: CHANNEL_NAME },
        },
        {
          name: SECRET_B_NAME,
          scope: { kind: "channel", owner: SECRET_B_OWNER },
        },
        {
          name: SECRET_C_NAME,
          scope: { kind: "connector", owner: CONNECTOR_NAME },
        },
        {
          name: SECRET_D_NAME,
          scope: { kind: "mcpServer", owner: MCP_SERVER_NAME },
        },
      ],
    },
  };
}

function buildLibraryManifest(): Record<string, unknown> {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "LibraryManifest",
    metadata: { name: LIB_MANIFEST_NAME },
    spec: {
      connectors: [
        {
          name: LIB_CONNECTOR_NAME,
          type: "http",
          config: { baseUrl: CONNECTOR_ADMIN_HEALTH_URL, context: "external" },
        },
      ],
    },
  };
}

/**
 * Builds one revision of the throwaway negative-test manifest. Each variant
 * embeds exactly ONE fail-loud shape in the workflow's action args, per this
 * file's header comment (ROUND 3). The channel + connector stay IDENTICAL
 * across all three variants so they are created ONCE (revision 1's apply
 * attempt) and come back `noop` for revisions 2/3 — no new resource is ever
 * created beyond that first structural pair.
 */
function buildNegativeManifest(
  variant: "unallowlisted" | "mismatched" | "invalid-array-shape"
): Record<string, unknown> {
  const baseActionArgs: Record<string, unknown> = {
    code: "(ctx) => ({ ok: true })",
  };
  let actionArgs = baseActionArgs;
  let trigger: Record<string, unknown> = {
    type: "message_received",
    mode: "shared",
    config: {
      channels: ["http"],
      providers: ["http"],
      accountIds: [{ channelRef: NEG_CHANNEL_NAME }],
    },
  };

  if (variant === "unallowlisted") {
    // `someUnknownKey` is not in SUBSTITUTION_ALLOWLIST at all — a
    // recognized `{ channelRef }` ref-object sitting there would silently
    // corrupt the resource if forwarded verbatim, so the walker fails loud.
    actionArgs = {
      ...baseActionArgs,
      someUnknownKey: { channelRef: NEG_CHANNEL_NAME },
    };
  } else if (variant === "mismatched") {
    // `accountId` IS allowlisted, but only accepts `channelRef` — a
    // `connectorRef` value there is a recognized ref-object of the WRONG
    // kind for this key.
    actionArgs = {
      ...baseActionArgs,
      accountId: { connectorRef: NEG_CONNECTOR_NAME },
    };
  } else {
    // `accountIds` is array-allowlisted (`channelRef` elements) — a
    // NON-array value at this key is an authoring-shape mismatch, not a
    // legitimate scalar use (see `substitute-symbolic-refs.ts`'s own
    // comment: a MIXED array is legal, so the true "invalid shape" trigger
    // is a non-array value, not a mixed one — deviates from this task's own
    // "mixed shape" example, which the walker's actual code treats as
    // legal; verified against the real implementation, not assumed).
    trigger = {
      type: "message_received",
      mode: "shared",
      config: {
        channels: ["http"],
        providers: ["http"],
        accountIds: { channelRef: NEG_CHANNEL_NAME },
      },
    };
  }

  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: NEG_MANIFEST_NAME },
    spec: {
      channels: [
        { name: NEG_CHANNEL_NAME, type: "http", direction: "inbound" },
      ],
      connectors: [
        {
          name: NEG_CONNECTOR_NAME,
          type: "http",
          config: { baseUrl: CONNECTOR_ADMIN_HEALTH_URL, context: "external" },
        },
      ],
      workflows: [
        {
          name: NEG_WORKFLOW_NAME,
          definition: {
            application: NEG_MANIFEST_NAME,
            actions: [
              {
                activity: "jsFunction",
                name: "neg-action",
                args: actionArgs,
              },
            ],
            trigger,
          },
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Plan/apply assertions
// ---------------------------------------------------------------------------

interface TimedPlan {
  readonly latencyMs: number;
  readonly resources: { kind: string; name: string; verdict: string }[];
  readonly preconditionsCount: number;
}

interface TimedApply {
  readonly latencyMs: number;
  readonly appliedCount: number;
  readonly noopCount: number;
  readonly durationMs: number;
  readonly resources: {
    kind: string;
    name: string;
    verdict: string;
    externalId?: string;
  }[];
}

async function main(): Promise<void> {
  log(
    `starting T09+T1 showcase run: manifest='${MANIFEST_NAME}' tenant='${TENANT}' gateway='${GATEWAY_BASE_URL}' (Host: ${GATEWAY_HOST}) provisioning='${PROVISIONING_BASE_URL}' (Host: ${PROVISIONING_HOST})`
  );

  const client = createClient({
    tenant: TENANT,
    email: EMAIL,
    password: PASSWORD,
    baseUrl: GATEWAY_BASE_URL,
    fetch: withHostHeader(GATEWAY_HOST) as typeof fetch,
  });

  // --- 1. bind the four secrets (values NEVER logged) ----------------------

  log(
    `secrets.set('${SECRET_A_NAME}') scope=channel/${CHANNEL_NAME} (value never logged)`
  );
  await client.secrets.set(SECRET_A_NAME, SECRET_A_VALUE, {
    kind: "channel",
    owner: CHANNEL_NAME,
  });

  log(
    `secrets.set('${SECRET_B_NAME}') scope=channel/${SECRET_B_OWNER} (value never logged)`
  );
  await client.secrets.set(SECRET_B_NAME, SECRET_B_VALUE, {
    kind: "channel",
    owner: SECRET_B_OWNER,
  });

  log(
    `secrets.set('${SECRET_C_NAME}') scope=connector/${CONNECTOR_NAME} (value never logged)`
  );
  await client.secrets.set(SECRET_C_NAME, SECRET_C_VALUE, {
    kind: "connector",
    owner: CONNECTOR_NAME,
  });

  log(
    `secrets.set('${SECRET_D_NAME}') scope=mcpServer/${MCP_SERVER_NAME} (value never logged)`
  );
  await client.secrets.set(SECRET_D_NAME, SECRET_D_VALUE, {
    kind: "mcpServer",
    owner: MCP_SERVER_NAME,
  });

  // --- 2. put the manifest --------------------------------------------------

  log(`manifests.put('${MANIFEST_NAME}')`);
  const putResult = await client.manifests.put(MANIFEST_NAME, buildManifest());
  if (putResult.revision !== 1) {
    fail(
      `expected manifests.put() to return revision 1, got ${String(putResult.revision)}`
    );
  }

  // --- 3. first plan: all 7 resources create, zero preconditions ----------

  const EXPECTED_RESOURCE_COUNT = 7; // channel, connector, mcpServer, skill, agent, systemVariable, workflow

  log(
    `manifests.plan() — expect all-create (${String(EXPECTED_RESOURCE_COUNT)} resources), zero preconditions`
  );
  const planStart1 = Date.now();
  const plan1 = await client.manifests.plan(MANIFEST_NAME);
  const firstPlan: TimedPlan = {
    latencyMs: Date.now() - planStart1,
    resources: plan1.resources.map((r) => ({
      kind: r.kind,
      name: r.name,
      verdict: r.verdict,
    })),
    preconditionsCount: plan1.preconditions.length,
  };
  log(`first plan: ${JSON.stringify(firstPlan)}`);

  if (firstPlan.resources.length !== EXPECTED_RESOURCE_COUNT) {
    fail(
      `expected ${String(EXPECTED_RESOURCE_COUNT)} resources in the first plan, got ${String(firstPlan.resources.length)}`
    );
  }
  if (firstPlan.resources.some((r) => r.verdict !== "create")) {
    fail(
      `expected every resource verdict === 'create' in the first plan, got: ${JSON.stringify(firstPlan.resources)}`
    );
  }
  if (firstPlan.preconditionsCount !== 0) {
    fail(
      `expected zero preconditions in the first plan (all four secrets already bound), got ${String(firstPlan.preconditionsCount)}: ${JSON.stringify(plan1.preconditions)}`
    );
  }

  // --- 4. first apply: appliedCount === 7, noopCount === 0 -----------------

  log(
    `manifests.apply() — expect appliedCount=${String(EXPECTED_RESOURCE_COUNT)} noopCount=0`
  );
  const applyStart1 = Date.now();
  const apply1 = await client.manifests.apply(MANIFEST_NAME);
  const firstApply: TimedApply = {
    latencyMs: Date.now() - applyStart1,
    appliedCount: apply1.appliedCount,
    noopCount: apply1.noopCount,
    durationMs: apply1.durationMs,
    resources: apply1.resources.map((r) => ({
      kind: r.kind,
      name: r.name,
      verdict: r.verdict,
      externalId: r.externalId,
    })),
  };
  log(`first apply: ${JSON.stringify(firstApply)}`);

  if (
    firstApply.appliedCount !== EXPECTED_RESOURCE_COUNT ||
    firstApply.noopCount !== 0
  ) {
    fail(
      `expected first apply appliedCount=${String(EXPECTED_RESOURCE_COUNT)} noopCount=0, got appliedCount=${String(firstApply.appliedCount)} noopCount=${String(firstApply.noopCount)}`
    );
  }

  const findExternalId = (name: string): string | undefined =>
    firstApply.resources.find((r) => r.name === name)?.externalId;

  const channelExternalId = findExternalId(CHANNEL_NAME);
  const connectorExternalId = findExternalId(CONNECTOR_NAME);
  const mcpServerExternalId = findExternalId(MCP_SERVER_NAME);
  const skillExternalId = findExternalId(SKILL_NAME);
  const agentExternalId = findExternalId(AGENT_NAME);
  const systemVariableExternalId = findExternalId(SYSVAR_NAME);
  const workflowExternalId = findExternalId(WORKFLOW_NAME);
  const kbExternalId =
    (apply1.knowledgeBases ?? [])[0]?.kbName === KB_NAME
      ? ((apply1.knowledgeBases ?? [])[0] as { kbExternalId?: string })
          .kbExternalId
      : undefined;

  // T03 (agent-mcp-tool-naming.md) driver self-cleanup — register every
  // round-1 resource for defense-in-depth teardown THE MOMENT its
  // externalId is known, before any later step (including the
  // E2E_DIE_AFTER_APPLY / E2E_SIMULATE_SOFT_FAILURE_AFTER_APPLY hooks right
  // below) has a chance to die. The mcpServer is listed FIRST — it is the
  // one resource kind whose residue actively harms OTHER tenant traffic
  // (an enabled+active stray MCP server auto-connects for every agent, see
  // the SPEC's incident root cause 2) — so it is registered FIRST here and
  // `selfCleanup()` iterates `trackedResources` in this SAME (insertion,
  // priority) order — NOT reversed — specifically so mcpServer is the
  // FIRST resource removed on every self-cleanup path, not the last.
  trackForCleanup("mcpServer", MCP_SERVER_NAME, mcpServerExternalId, (id) =>
    client.mcpServers.remove(id)
  );
  trackForCleanup("agent", AGENT_NAME, agentExternalId, (id) =>
    client.agents.remove(id)
  );
  trackForCleanup("workflow", WORKFLOW_NAME, workflowExternalId, (id) =>
    client.workflows.remove(id)
  );
  trackForCleanup("skill", SKILL_NAME, skillExternalId, (id) =>
    client.skills.remove(id).then(() => undefined)
  );
  trackForCleanup(
    "systemVariable",
    SYSVAR_NAME,
    systemVariableExternalId,
    (id) => client.systemVariables.remove(id).then(() => undefined)
  );
  trackForCleanup("knowledgeBase", KB_NAME, kbExternalId, (id) =>
    client.knowledgeBases.remove(id).then(() => undefined)
  );
  trackForCleanup("connector", CONNECTOR_NAME, connectorExternalId, (id) =>
    client.connectors.remove(id)
  );
  trackForCleanup("channel", CHANNEL_NAME, channelExternalId, (id) =>
    client.channels.removeAccount(id)
  );

  // Regression test hook for the mid-run driver-death leak (see
  // scripts/e2e/teardown-regression.sh): manifest-apply.sh's cleanup() used
  // to resolve every showcase resource EXCLUSIVELY from this driver's final
  // JSON summary line. If the driver dies anywhere before that line prints —
  // crash, connection failure, ctrl-c — every SHOWCASE_*/LIB_*/NEG_* resource
  // it already created (this first apply just created 7+ of them, plus 4 k8s
  // Secrets) leaked with zero teardown. E2E_DIE_AFTER_APPLY=1 simulates
  // EXACTLY that: a HARD kill (`process.exit()` with no chance for this
  // file's own `finally`/error-handling to run at all) right after the
  // first successful apply, before any of the later rounds run and before
  // the JSON summary is ever assembled or printed. This is the ONE failure
  // mode T03's driver self-cleanup CANNOT recover from (a real `SIGKILL`
  // bypasses JS exception handling identically) — manifest-apply.sh's
  // cleanup() must still recover via its name-prefix/nonce sweep regardless
  // of this driver ever having produced JSON OR ever running its own
  // self-cleanup; that sweep stays the second line of defense for exactly
  // this case.
  if (process.env.E2E_DIE_AFTER_APPLY === "1") {
    console.error(
      "[showcase-driver] E2E_DIE_AFTER_APPLY=1 — simulating a HARD driver death (no self-cleanup chance) right after the first apply, before the JSON summary is printed"
    );
    process.exit(1);
  }

  // T03 regression hook (new): simulates the failure mode driver
  // self-cleanup DOES recover from — a thrown error mid-round, after
  // resources already exist but before the JSON summary prints. Unlike
  // E2E_DIE_AFTER_APPLY above, this goes through `fail()`/`throw`, so it
  // flows through `main().catch()` -> `selfCleanup()` exactly like any real
  // assertion failure would. Verifies "the driver's failure paths (throw
  // mid-round) all flow through the cleanup" independent of whether the
  // bash-side sweep would ALSO have caught it.
  if (process.env.E2E_SIMULATE_SOFT_FAILURE_AFTER_APPLY === "1") {
    fail(
      "E2E_SIMULATE_SOFT_FAILURE_AFTER_APPLY=1 — simulating a thrown mid-round failure right after the first apply, to prove selfCleanup() runs before this process exits non-zero"
    );
  }

  // --- 5. second plan: all 7 resources noop --------------------------------

  log("manifests.plan() again — expect all-noop (converged)");
  const planStart2 = Date.now();
  const plan2 = await client.manifests.plan(MANIFEST_NAME);
  const secondPlan: TimedPlan = {
    latencyMs: Date.now() - planStart2,
    resources: plan2.resources.map((r) => ({
      kind: r.kind,
      name: r.name,
      verdict: r.verdict,
    })),
    preconditionsCount: plan2.preconditions.length,
  };
  log(`second plan: ${JSON.stringify(secondPlan)}`);

  if (secondPlan.resources.some((r) => r.verdict !== "noop")) {
    fail(
      `expected every resource verdict === 'noop' in the second plan, got: ${JSON.stringify(secondPlan.resources)}`
    );
  }

  // --- 6. second apply: no-op ----------------------------------------------

  log(
    `manifests.apply() again — expect appliedCount=0 noopCount=${String(EXPECTED_RESOURCE_COUNT)} (idempotent)`
  );
  const applyStart2 = Date.now();
  const apply2 = await client.manifests.apply(MANIFEST_NAME);
  const secondApply: TimedApply = {
    latencyMs: Date.now() - applyStart2,
    appliedCount: apply2.appliedCount,
    noopCount: apply2.noopCount,
    durationMs: apply2.durationMs,
    resources: apply2.resources.map((r) => ({
      kind: r.kind,
      name: r.name,
      verdict: r.verdict,
      externalId: r.externalId,
    })),
  };
  log(`second apply: ${JSON.stringify(secondApply)}`);

  if (
    secondApply.appliedCount !== 0 ||
    secondApply.noopCount !== EXPECTED_RESOURCE_COUNT
  ) {
    fail(
      `expected second apply to be a no-op (appliedCount=0 noopCount=${String(EXPECTED_RESOURCE_COUNT)}), got appliedCount=${String(secondApply.appliedCount)} noopCount=${String(secondApply.noopCount)}`
    );
  }

  // --- 7. NEGATIVE broker test: mismatched binding, direct to provisioning-service ---

  const denyCorrelationId = randomUUID();
  log(
    `internal broker resolve (NEGATIVE, direct to provisioning-service, never through the gateway): consumer='channel-service' secret='${SECRET_B_NAME}' actingResource=channel/${CHANNEL_NAME} (secret B is bound to a DIFFERENT owner '${SECRET_B_OWNER}' — expect binding_mismatch)`
  );
  const brokerFetch = withHostHeader(PROVISIONING_HOST);
  const brokerResponse = await brokerFetch(
    `${PROVISIONING_BASE_URL}/internal/secrets/resolve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-yoizen-tenant": TENANT,
      },
      body: JSON.stringify({
        consumerService: "channel-service",
        secretName: SECRET_B_NAME,
        actingResource: { kind: "channel", owner: CHANNEL_NAME },
        correlationId: denyCorrelationId,
      }),
    }
  );
  const brokerBody = (await brokerResponse.json()) as {
    ok: boolean;
    error?: { kind: string; message: string };
  };
  log(
    `negative broker result: httpStatus=${String(brokerResponse.status)} body=${JSON.stringify(brokerBody)}`
  );

  if (brokerBody.ok !== false) {
    fail(
      `expected the mismatched-binding broker resolve to be DENIED (ok: false), got ok=${String(brokerBody.ok)}`
    );
  }
  if (brokerBody.error?.kind !== "binding_mismatch") {
    fail(
      `expected error.kind === 'binding_mismatch', got: ${JSON.stringify(brokerBody.error)}`
    );
  }

  // --- 8. ROUND 2: mini LibraryManifest (one connector, no channel/workflow) --

  log(`manifests.put('${LIB_MANIFEST_NAME}') — kind: LibraryManifest`);
  const libPut = await client.manifests.put(
    LIB_MANIFEST_NAME,
    buildLibraryManifest()
  );
  if (libPut.revision !== 1) {
    fail(
      `expected LibraryManifest put() to return revision 1, got ${String(libPut.revision)}`
    );
  }

  log(`manifests.plan('${LIB_MANIFEST_NAME}') — expect create 1`);
  const libPlan = await client.manifests.plan(LIB_MANIFEST_NAME);
  if (
    libPlan.resources.length !== 1 ||
    libPlan.resources[0]?.verdict !== "create"
  ) {
    fail(
      `expected LibraryManifest plan to show exactly 1 resource verdict=create, got: ${JSON.stringify(libPlan.resources)}`
    );
  }

  log(`manifests.apply('${LIB_MANIFEST_NAME}') — expect appliedCount=1`);
  const libApply1 = await client.manifests.apply(LIB_MANIFEST_NAME);
  if (libApply1.appliedCount !== 1 || libApply1.noopCount !== 0) {
    fail(
      `expected LibraryManifest first apply appliedCount=1 noopCount=0, got appliedCount=${String(libApply1.appliedCount)} noopCount=${String(libApply1.noopCount)}`
    );
  }
  const libConnectorExternalId = libApply1.resources.find(
    (r) => r.name === LIB_CONNECTOR_NAME
  )?.externalId;

  // T03 driver self-cleanup — same tracking as round 1's resources above.
  trackForCleanup(
    "connector",
    LIB_CONNECTOR_NAME,
    libConnectorExternalId,
    (id) => client.connectors.remove(id)
  );

  log(
    `manifests.apply('${LIB_MANIFEST_NAME}') again — expect appliedCount=0 noopCount=1`
  );
  const libApply2 = await client.manifests.apply(LIB_MANIFEST_NAME);
  if (libApply2.appliedCount !== 0 || libApply2.noopCount !== 1) {
    fail(
      `expected LibraryManifest second apply to be a no-op (appliedCount=0 noopCount=1), got appliedCount=${String(libApply2.appliedCount)} noopCount=${String(libApply2.noopCount)}`
    );
  }
  log(
    `ROUND 2 (LibraryManifest) passed: connector '${LIB_CONNECTOR_NAME}' externalId='${String(libConnectorExternalId)}'`
  );

  // --- 9. ROUND 3: plan-only negative tests (throwaway manifest) -----------

  const negativeResults: {
    variant: string;
    expectedErrorKind: string;
    actualErrorKind?: string;
  }[] = [];

  const NEGATIVE_VARIANTS: {
    variant: "unallowlisted" | "mismatched" | "invalid-array-shape";
    expectedErrorKind: string;
  }[] = [
    {
      variant: "unallowlisted",
      expectedErrorKind: "unallowlisted_symbolic_ref",
    },
    { variant: "mismatched", expectedErrorKind: "mismatched_symbolic_ref" },
    {
      variant: "invalid-array-shape",
      expectedErrorKind: "invalid_array_substitution_shape",
    },
  ];

  for (const { variant, expectedErrorKind } of NEGATIVE_VARIANTS) {
    log(
      `ROUND 3 negative test '${variant}' — manifests.put('${NEG_MANIFEST_NAME}')`
    );
    await client.manifests.put(
      NEG_MANIFEST_NAME,
      buildNegativeManifest(variant)
    );

    log(
      `ROUND 3 negative test '${variant}' — manifests.plan() (expect success, all-create — substitution never runs at plan time)`
    );
    const negPlan = await client.manifests.plan(NEG_MANIFEST_NAME);
    if (negPlan.resources.length === 0) {
      fail(
        `ROUND 3 negative test '${variant}': expected a non-empty plan, got zero resources`
      );
    }

    log(
      `ROUND 3 negative test '${variant}' — manifests.apply() (expect a thrown ConflictError with failure.kind='${expectedErrorKind}')`
    );
    let actualErrorKind: string | undefined;
    try {
      await client.manifests.apply(NEG_MANIFEST_NAME);
      fail(
        `ROUND 3 negative test '${variant}': expected manifests.apply() to THROW (ConflictError), it resolved successfully instead`
      );
    } catch (error) {
      // `fail()` now THROWS (T03: self-cleanup needs every failure to flow
      // through `main().catch()`) — a `ShowcaseAssertionError` thrown by the
      // `fail()` call right above (apply() unexpectedly resolved) would
      // otherwise be swallowed by this very catch block and reported as
      // "expected a ConflictError, got ShowcaseAssertionError" instead of
      // its real, more useful message. Re-throw it untouched.
      if (error instanceof ShowcaseAssertionError) {
        throw error;
      }
      if (!(error instanceof ConflictError)) {
        fail(
          `ROUND 3 negative test '${variant}': expected a ConflictError, got: ${error instanceof Error ? error.constructor.name : String(error)}`
        );
      }
      const body = (
        error as ConflictError & {
          details?: { body?: { error?: { failure?: { kind?: string } } } };
        }
      ).details?.body;
      actualErrorKind = body?.error?.failure?.kind;
      log(
        `ROUND 3 negative test '${variant}': apply() rejected as expected, failure.kind='${String(actualErrorKind)}'`
      );
    }

    if (actualErrorKind !== expectedErrorKind) {
      fail(
        `ROUND 3 negative test '${variant}': expected failure.kind === '${expectedErrorKind}', got '${String(actualErrorKind)}'`
      );
    }

    // The bad workflow is expected NEVER to reach the writer (substitution
    // fails BEFORE the write, RESOURCE_KIND_ORDER ranks "workflow" last).
    // This driver does NOT itself assert that absence — it has no
    // workflow-service wiring; the bash caller (stage 8c) independently
    // confirms via `workflow_curl GET /workflows` name lookup that no
    // workflow named `negativeManifest.workflowName` exists after this
    // round, and FAILS the script if one does.
    negativeResults.push({ variant, expectedErrorKind, actualErrorKind });
  }

  // --- summary --------------------------------------------------------------

  const summary = {
    ok: true,
    manifestName: MANIFEST_NAME,
    channelName: CHANNEL_NAME,
    connectorName: CONNECTOR_NAME,
    mcpServerName: MCP_SERVER_NAME,
    skillName: SKILL_NAME,
    systemVariableName: SYSVAR_NAME,
    agentName: AGENT_NAME,
    kbName: KB_NAME,
    workflowName: WORKFLOW_NAME,
    secretAName: SECRET_A_NAME,
    secretAOwner: CHANNEL_NAME,
    secretBName: SECRET_B_NAME,
    secretBOwner: SECRET_B_OWNER,
    secretCName: SECRET_C_NAME,
    secretCOwner: CONNECTOR_NAME,
    secretDName: SECRET_D_NAME,
    secretDOwner: MCP_SERVER_NAME,
    channelExternalId,
    connectorExternalId,
    mcpServerExternalId,
    skillExternalId,
    agentExternalId,
    systemVariableExternalId,
    workflowExternalId,
    kbExternalId,
    denyCorrelationId,
    firstPlan,
    firstApply,
    secondPlan,
    secondApply,
    negativeBroker: {
      httpStatus: brokerResponse.status,
      ok: brokerBody.ok,
      errorKind: brokerBody.error?.kind,
    },
    libraryManifest: {
      manifestName: LIB_MANIFEST_NAME,
      connectorName: LIB_CONNECTOR_NAME,
      connectorExternalId: libConnectorExternalId,
    },
    negativeManifest: {
      manifestName: NEG_MANIFEST_NAME,
      channelName: NEG_CHANNEL_NAME,
      connectorName: NEG_CONNECTOR_NAME,
      workflowName: NEG_WORKFLOW_NAME,
      results: negativeResults,
    },
  };

  log("all showcase assertions passed (rounds 1, 2, and 3)");
  console.log(JSON.stringify(summary));
}

// T03 driver self-cleanup — a "run in progress" flag so the SIGINT/SIGTERM
// handlers below never double-run `selfCleanup()` alongside `main()`'s own
// catch handler (e.g. a signal arriving while the catch handler's own
// `selfCleanup()` call is already in flight).
let cleanupInFlight: Promise<void> | undefined;

function runSelfCleanupOnce(reason: string): Promise<void> {
  cleanupInFlight ??= selfCleanup(reason);
  return cleanupInFlight;
}

main()
  .then(() => {
    // Success path — unchanged from before T03: manifest-apply.sh's own
    // JSON-driven teardown (using this driver's JSON summary, just printed)
    // remains the owner of these resources' lifecycle, exactly as before.
  })
  .catch(async (error: unknown) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[showcase-driver] FATAL: ${message}`);
    await runSelfCleanupOnce("uncaught-error");
    // Known-flake diagnosability (gaps-5 T02 follow-up): the FATAL print
    // above happens BEFORE self-cleanup, so in a long run its message ends
    // up buried under the cleanup log lines and the harness can only say
    // "driver FAILED (see stderr above)". Re-print a one-line summary as the
    // driver's very LAST stderr line so the failed assertion's own message
    // sits directly next to manifest-apply.sh's stage-failure line.
    const firstLine = (
      error instanceof Error ? error.message : String(error)
    ).split("\n", 1)[0];
    console.error(
      `[showcase-driver] FAILED${error instanceof ShowcaseAssertionError ? " ASSERTION" : ""}: ${firstLine}`
    );
    process.exit(1);
  });

// T03 driver self-cleanup — SIGINT ("manual interruption", the exact
// residue-causing scenario the SPEC's incident section names) and SIGTERM
// (the signal Kubernetes/CI job cancellation sends before a hard kill) both
// get a chance to tear down every tracked resource before the process
// exits. A `SIGKILL`/OOM-kill bypasses this entirely by design — that case
// stays covered exclusively by manifest-apply.sh's nonce-suffix sweep (see
// this file's header comment and `E2E_DIE_AFTER_APPLY` above).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.error(
      `[showcase-driver] received ${signal} — running self-cleanup before exit`
    );
    void runSelfCleanupOnce(signal).then(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  });
}
