#!/usr/bin/env bun
/**
 * e2e-manifest-showcase-driver.ts — T09 (manual-loops/declarative-provisioning.md)
 * "full showcase" manifest driven through the REAL SDK (`sdk/src/index.ts`,
 * imported directly by relative path — the package ships no build output in
 * this workspace and `bun` resolves the `.js`-suffixed relative imports the
 * SDK's own source uses onto their `.ts` files natively, exactly like every
 * other file inside `sdk/src` importing its siblings).
 *
 * Invoked by `scripts/e2e-manifest-apply.sh` (never run standalone in CI) —
 * the bash script owns cluster reachability checks, trap-guarded teardown of
 * every downstream resource this driver creates, and the tracking-ingester
 * Postgres assertions (this driver has no cluster-internal DB access). This
 * file owns exactly the SDK-facing round trip:
 *
 *   1. `client.secrets.set()` twice — secret A bound to the showcase
 *      channel's real owner name, secret B bound to a DIFFERENT (throwaway)
 *      owner name, so the two land in separate k8s Secrets
 *      (`psec-channel-<owner>`, SPEC.md decision 4: one Secret per resource).
 *   2. `client.manifests.put()` a manifest with a channel (secretRef ->
 *      secret A), a connector (NO secretRef — see the deferral note below),
 *      an agent (knowledgeBaseRefs -> the KB), a knowledge base (inline
 *      document), and a workflow wiring channel+agent via channelRef/agentRef
 *      in `definition.variables`.
 *   3. `client.manifests.plan()` -> assert all 4 resources verdict `create`,
 *      zero preconditions (the secret is already bound).
 *   4. `client.manifests.apply()` -> assert appliedCount === 4, noopCount === 0.
 *   5. `client.manifests.plan()` again -> assert all 4 resources verdict `noop`.
 *   6. `client.manifests.apply()` again -> assert appliedCount === 0,
 *      noopCount === 4 (idempotent re-apply).
 *   7. NEGATIVE broker test: a raw `fetch` straight at provisioning-service's
 *      INTERNAL-ONLY `POST /internal/secrets/resolve` route (never through
 *      the gateway — that route has no gateway proxy by design, T07) with a
 *      MISMATCHED binding: consumer `channel-service` (authorized for
 *      `channel` secrets) claims to act for the SHOWCASE channel's owner but
 *      asks for secret B, which is bound to the OTHER owner. The broker's
 *      binding-match check (not the consumer-authorization check) is what
 *      denies this — `error.kind === "binding_mismatch"`.
 *
 * DEFERRAL (per SPEC.md T05 + this task's scope note): a connector's
 * `secretRef` fails apply with `secret_not_resolvable` — connector auth
 * wiring through the broker is an explicit follow-up beyond T05's scope
 * (`connectors-writer.ts`'s header comment). So THIS manifest's connector
 * carries no `secretRef`; the full secret round-trip (PUT -> bound ->
 * resolved by an authorized consumer via the apply engine -> denied for a
 * mismatched one) is exercised entirely through the CHANNEL's secretRef
 * (which DOES resolve through the broker, `channels-writer.ts`) plus the
 * direct broker negative call above.
 *
 * CI note: the channel uses `type: "http"` rather than `telegram` — real
 * Telegram bot credentials do not exist in the dev cluster, and `http` is
 * the exact fallback this task's SPEC section calls for. The resource is
 * still NAMED `e2e-telegram-*` so the showcase narrative reads as intended.
 *
 * Exits 0 with a single JSON summary line on stdout (parsed by the bash
 * caller for teardown externalIds + tracking-query correlation values).
 * Exits 1 with a diagnostic on stderr for any failed assertion — never
 * throws an uncaught exception past `main()`. The secret VALUES (`SECRET_A_VALUE`,
 * `SECRET_B_VALUE` below) are NEVER logged, NEVER included in the JSON
 * summary, and NEVER printed — only names/owners/verdicts are.
 */

import { randomUUID } from "node:crypto";
import { createClient } from "../sdk/src/index.js";

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

function fail(msg: string): never {
  console.error(`[showcase-driver] ASSERTION FAILED: ${msg}`);
  process.exit(1);
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

// Never logged, never returned in the JSON summary — literal values only
// travel inside the two `secrets.set()` request bodies below.
const SECRET_A_VALUE = `e2e-secret-a-value-${randomUUID()}`;
const SECRET_B_VALUE = `e2e-secret-b-value-${randomUUID()}`;

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
          // NO secretRef — connector auth wiring through the broker is a
          // T05-documented follow-up (see header comment); resolving one
          // here would fail apply with `secret_not_resolvable`.
          config: { baseUrl: CONNECTOR_ADMIN_HEALTH_URL, context: "external" },
        },
      ],
      agents: [
        {
          name: AGENT_NAME,
          profile: {
            description: "e2e showcase agent (T09 declarative-provisioning)",
            system_prompt:
              "You are an e2e showcase agent. Never used for real traffic.",
          },
          knowledgeBaseRefs: [KB_NAME],
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
            ],
            // Wiring: references the channel + agent this manifest also
            // declares — walked by validate-structural-rules.ts's
            // collectSymbolicRefs, resolved by NAME (not substituted into
            // the workflow definition sent to workflow-service — that
            // real-id substitution is a known follow-up, not this task's
            // scope; see workflows-writer.ts).
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
    `starting T09 showcase run: manifest='${MANIFEST_NAME}' tenant='${TENANT}' gateway='${GATEWAY_BASE_URL}' (Host: ${GATEWAY_HOST}) provisioning='${PROVISIONING_BASE_URL}' (Host: ${PROVISIONING_HOST})`
  );

  const client = createClient({
    tenant: TENANT,
    email: EMAIL,
    password: PASSWORD,
    baseUrl: GATEWAY_BASE_URL,
    fetch: withHostHeader(GATEWAY_HOST) as typeof fetch,
  });

  // --- 1. bind the two secrets (values NEVER logged) ----------------------

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

  // --- 2. put the manifest --------------------------------------------------

  log(`manifests.put('${MANIFEST_NAME}')`);
  const putResult = await client.manifests.put(MANIFEST_NAME, buildManifest());
  if (putResult.revision !== 1) {
    fail(
      `expected manifests.put() to return revision 1, got ${String(putResult.revision)}`
    );
  }

  // --- 3. first plan: all 4 resources create, zero preconditions ----------

  log("manifests.plan() — expect all-create, zero preconditions");
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

  if (firstPlan.resources.length !== 4) {
    fail(
      `expected 4 resources in the first plan, got ${String(firstPlan.resources.length)}`
    );
  }
  if (firstPlan.resources.some((r) => r.verdict !== "create")) {
    fail(
      `expected every resource verdict === 'create' in the first plan, got: ${JSON.stringify(firstPlan.resources)}`
    );
  }
  if (firstPlan.preconditionsCount !== 0) {
    fail(
      `expected zero preconditions in the first plan (secret A already bound), got ${String(firstPlan.preconditionsCount)}: ${JSON.stringify(plan1.preconditions)}`
    );
  }

  // --- 4. first apply: appliedCount === 4, noopCount === 0 -----------------

  log("manifests.apply() — expect appliedCount=4 noopCount=0");
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

  if (firstApply.appliedCount !== 4 || firstApply.noopCount !== 0) {
    fail(
      `expected first apply appliedCount=4 noopCount=0, got appliedCount=${String(firstApply.appliedCount)} noopCount=${String(firstApply.noopCount)}`
    );
  }

  const channelExternalId = firstApply.resources.find(
    (r) => r.name === CHANNEL_NAME
  )?.externalId;
  const connectorExternalId = firstApply.resources.find(
    (r) => r.name === CONNECTOR_NAME
  )?.externalId;
  const agentExternalId = firstApply.resources.find(
    (r) => r.name === AGENT_NAME
  )?.externalId;
  const workflowExternalId = firstApply.resources.find(
    (r) => r.name === WORKFLOW_NAME
  )?.externalId;
  const kbExternalId =
    (apply1.knowledgeBases ?? [])[0]?.kbName === KB_NAME
      ? ((apply1.knowledgeBases ?? [])[0] as { kbExternalId?: string })
          .kbExternalId
      : undefined;

  // --- 5. second plan: all 4 resources noop --------------------------------

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
    "manifests.apply() again — expect appliedCount=0 noopCount=4 (idempotent)"
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

  if (secondApply.appliedCount !== 0 || secondApply.noopCount !== 4) {
    fail(
      `expected second apply to be a no-op (appliedCount=0 noopCount=4), got appliedCount=${String(secondApply.appliedCount)} noopCount=${String(secondApply.noopCount)}`
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

  // --- summary --------------------------------------------------------------

  const summary = {
    ok: true,
    manifestName: MANIFEST_NAME,
    channelName: CHANNEL_NAME,
    connectorName: CONNECTOR_NAME,
    agentName: AGENT_NAME,
    kbName: KB_NAME,
    workflowName: WORKFLOW_NAME,
    secretAName: SECRET_A_NAME,
    secretAOwner: CHANNEL_NAME,
    secretBName: SECRET_B_NAME,
    secretBOwner: SECRET_B_OWNER,
    channelExternalId,
    connectorExternalId,
    agentExternalId,
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
  };

  log("all showcase assertions passed");
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[showcase-driver] FATAL: ${message}`);
  process.exit(1);
});
