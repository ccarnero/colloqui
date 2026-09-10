import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { IntegrationManifest } from "@yoizen/shared";
import {
  attemptJ3Operation,
  completeJ3Operation,
  diagnosticFailureForWriteOutcome,
  failJ3Operation,
  initialJ3Diagnostic,
  inspectApplyResponse,
  isNanoId,
  normalizeTransportOutcome,
  observeOwnedExecutions,
  preservationState,
  preservePrimaryFailure,
  resolveInboundAccount,
  safeDiagnosticFailure,
  safetyFailureStage,
  sameSnapshot,
  snapshotResources,
  updateJ3Observations,
  withoutOwned,
  writeJ3DiagnosticCheckpoint,
  workflowMutationAuthority,
  type DiagnosticFailureCode,
  type J3Checkpoint,
  type J3DiagnosticState,
  type J3Operation,
  type OwnedExecutionObservations,
  type SafeDiagnosticFailure,
  type SafeTransportResult,
  type SnapshotEntry,
} from "./platform-evaluation-state";

type Row = Readonly<Record<string, unknown>>;
type Verdict = "pending" | "passed" | "failed";
type JourneyId = "J1" | "J2" | "J3" | "J4" | "J5";

interface RuntimeConfig {
  readonly apiUrl: string;
  readonly baseUrl: string;
  readonly tenant: "acme";
  readonly email: string;
  readonly password: string;
  readonly restrictedToken: string;
}

interface Snapshot {
  readonly channels: readonly SnapshotEntry[];
  readonly workflows: readonly SnapshotEntry[];
}

interface OwnedLedger {
  readonly runId: string;
  readonly startedAt: string;
  finishedAt?: string;
  manifests: Array<Readonly<{ name: string; revision: number; hash: string }>>;
  channelIds: string[];
  workflowId?: string;
  executionIds: string[];
  correlationIds: string[];
  retained: Array<Readonly<{ kind: string; id: string; hash: string; status: string }>>;
  verdicts: Record<JourneyId, Verdict>;
  finallyDisable: "not-needed" | "disabled" | "failed";
  finallyDisableEvidence?: Readonly<{ status: number; state: "disabled" }> | Readonly<{ state: "failed"; reason: "verification-or-request-failed" }>;
  failedStage?: JourneyId | "preservation" | "safety";
  preservation?: "passed" | "failed";
  j3Diagnostic: J3DiagnosticState;
  diagnosticWriteFailure?: SafeDiagnosticFailure;
  secondaryFailures: SafeDiagnosticFailure[];
}

class J3ActionError extends Error {
  constructor(readonly code: DiagnosticFailureCode, readonly status?: number) {
    super(code);
  }
}

const execFileAsync = promisify(execFile);
const EVIDENCE_ROOT =
  "manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLL_MS = 1_000;
const POLL_LIMIT_MS = 120_000;

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rowsOf = (value: unknown): Row[] => {
  if (Array.isArray(value)) return value.filter(isRow);
  if (!isRow(value)) return [];
  for (const key of ["items", "resources", "events", "spans"] as const) {
    if (Array.isArray(value[key])) return value[key].filter(isRow);
  }
  return [];
};

const stringOf = (row: Row, ...keys: string[]): string | undefined => {
  for (const key of keys) if (typeof row[key] === "string") return row[key] as string;
  return undefined;
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!isRow(value)) return JSON.stringify(value) ?? "null";
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};

const semanticHash = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

const diagnosticFailureOf = (error: unknown): SafeDiagnosticFailure => {
  if (error instanceof J3ActionError) return safeDiagnosticFailure(error.code, error.status);
  if (error instanceof SyntaxError) return safeDiagnosticFailure("malformed_response");
  const message = error instanceof Error ? error.message : "";
  const http = message.match(/ returned HTTP ([0-9]{3})$/);
  if (http) return safeDiagnosticFailure("http_error", Number(http[1]));
  if (message.endsWith("failed before an HTTP response")) return safeDiagnosticFailure("transport_error");
  if (message.includes("did not satisfy its condition within 120 seconds")) return safeDiagnosticFailure("timeout");
  return safeDiagnosticFailure("assertion_failed");
};

const decodeJwt = (token: string): Row => {
  const part = token.split(".")[1];
  if (!part) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return isRow(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const readConfig = (): RuntimeConfig => {
  const required = [
    "E2E_API_URL",
    "E2E_BASE_URL",
    "E2E_TENANT",
    "E2E_EMAIL",
    "E2E_PASSWORD",
    "E2E_RESTRICTED_TOKEN",
  ] as const;
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  let apiUrl: URL;
  let baseUrl: URL;
  try {
    apiUrl = new URL(process.env.E2E_API_URL!);
    baseUrl = new URL(process.env.E2E_BASE_URL!);
  } catch {
    throw new Error("E2E URLs must be valid approved local URLs");
  }
  const allowedHosts = new Set([
    "api-gateway.platform-services-dev.dev.local",
    "admin-console.platform-services-dev.dev.local",
  ]);
  if (apiUrl.href !== "http://api-gateway.platform-services-dev.dev.local/")
    throw new Error("E2E_API_URL must be the approved local gateway URL");
  if (baseUrl.href !== "http://admin-console.platform-services-dev.dev.local/")
    throw new Error("E2E_BASE_URL must be the approved local console URL");
  if (!allowedHosts.has(apiUrl.hostname) || !allowedHosts.has(baseUrl.hostname))
    throw new Error("Only approved local hosts are allowed");
  if (process.env.E2E_TENANT !== "acme") throw new Error("E2E_TENANT must be acme");
  return {
    apiUrl: apiUrl.origin,
    baseUrl: baseUrl.origin,
    tenant: "acme",
    email: process.env.E2E_EMAIL!,
    password: process.env.E2E_PASSWORD!,
    restrictedToken: process.env.E2E_RESTRICTED_TOKEN!,
  };
};

const authHeaders = (token: string, tenant = "acme"): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  "x-yoizen-tenant": tenant,
});

async function jsonResponse(
  request: APIRequestContext,
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  expected: number | readonly number[],
  options: { headers?: Record<string, string>; data?: unknown } = {}
): Promise<unknown> {
  let response;
  try {
    response = await request.fetch(url, { method, headers: options.headers, data: options.data });
  } catch {
    throw new Error(`${method} ${new URL(url).pathname} failed before an HTTP response`);
  }
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.includes(response.status()))
    throw new Error(`${method} ${new URL(url).pathname} returned HTTP ${response.status()}`);
  const contentType = response.headers()["content-type"] ?? "";
  return contentType.includes("json") ? response.json() : {};
}

async function jsonResponseWithStatus(
  request: APIRequestContext,
  method: "POST",
  url: string,
  expected: readonly number[],
  options: { headers?: Record<string, string>; data?: unknown } = {}
): Promise<Readonly<{ status: number; body: unknown }>> {
  let response;
  try {
    response = await request.fetch(url, { method, headers: options.headers, data: options.data });
  } catch {
    throw new Error(`${method} ${new URL(url).pathname} failed before an HTTP response`);
  }
  if (!expected.includes(response.status()))
    throw new Error(`${method} ${new URL(url).pathname} returned HTTP ${response.status()}`);
  const contentType = response.headers()["content-type"] ?? "";
  return { status: response.status(), body: contentType.includes("json") ? await response.json() : {} };
}

async function poll<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (Date.now() < deadline) {
    const found = await read();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`${label} did not satisfy its condition within 120 seconds`);
}

const manifestFor = (name: string, channel: string, sink: string, workflow: string): IntegrationManifest => ({
  apiVersion: "yoizen.io/v1",
  kind: "IntegrationManifest",
  metadata: { name },
  spec: {
    channels: [
      { name: channel, type: "http", direction: "inbound" },
      { name: sink, type: "e2e-tests", direction: "outbound" },
    ],
    workflows: [{
      name: workflow,
      definition: {
        application: "e2e",
        actions: [
          { name: "compute", activity: "jsFunction", args: { code: "(ctx) => ({ nonce: ctx.request.text, branch: 'expected' })" } },
          {
            name: "route",
            activity: "conditional",
            branches: [
              { label: "false-branch", condition: { variable: "request.text", comparator: "eq", value: "never-match" }, actions: [{ name: "false-step", activity: "jsFunction", args: { code: "() => 'wrong'" } }] },
              { label: "expected-branch", condition: { variable: "request.text", comparator: "contains", value: "eval-e2e-" }, actions: [{ name: "send-owned", activity: "channelSend", args: { accountId: { channelRef: sink }, channel: "e2e-tests", provider: "e2e-tests", to: `recipient-${name}`, type: "text", text: "{{request.text}}" } }] },
            ],
          },
        ],
        trigger: { type: "message_received", mode: "shared", config: { channels: ["http"], providers: ["http"], accountIds: [{ channelRef: channel }] } },
      },
    }],
    connectors: [],
    mcpServers: [],
    skills: [],
    agents: [],
    knowledgeBases: [],
    services: [],
    systemVariables: [],
    secrets: [],
  },
});

const unresolvedManifestFor = (name: string, workflow: string): IntegrationManifest => ({
  apiVersion: "yoizen.io/v1",
  kind: "IntegrationManifest",
  metadata: { name },
  spec: {
    channels: [{ name: "missing-owned-channel", type: "http", direction: "inbound", external: true }],
    workflows: [{ name: workflow, definition: { application: "e2e", actions: [{ name: "send", activity: "channelSend", args: { accountId: { channelRef: "missing-owned-channel" }, channel: "e2e-tests", provider: "e2e-tests", to: "nobody", type: "text", text: "never" } }], trigger: { type: "manual" } } }],
    connectors: [],
    mcpServers: [],
    skills: [],
    agents: [],
    knowledgeBases: [],
    services: [],
    systemVariables: [],
    secrets: [],
  },
});

test("J1 J2 J3 J4 J5 — built-image representative platform journeys", async ({ page, request }) => {
  const config = readConfig();
  const runId = process.env.E2E_EVAL_RUN_ID ?? randomUUID();
  if (!UUID.test(runId)) throw new Error("E2E_EVAL_RUN_ID must be a UUID");
  const prefix = `eval-e2e-${runId}`;
  const evidenceDir = `${EVIDENCE_ROOT}/${runId}`;
  const names = { manifest: `${prefix}-manifest`, invalid: `${prefix}-invalid`, channel: `${prefix}-in`, sink: `${prefix}-out`, workflow: `${prefix}-workflow` };
  const ledger: OwnedLedger = { runId, startedAt: new Date().toISOString(), manifests: [], channelIds: [], executionIds: [], correlationIds: [], retained: [], verdicts: { J1: "pending", J2: "pending", J3: "pending", J4: "pending", J5: "pending" }, finallyDisable: "not-needed", j3Diagnostic: initialJ3Diagnostic(), secondaryFailures: [] };
  let token = "";
  let baseline: Snapshot | undefined;
  let appSecret = "";
  let firstExecution: Row | undefined;
  let verifiedWorkflowId: string | undefined;
  let inboundWebhookPath: string | undefined;
  let primaryError: unknown;
  let j3CheckpointSequence = 0;
  const api = (path: string) => `${config.apiUrl}/api${path}`;
  const persistJ3Diagnostic = async (): Promise<void> => {
    const outcome = await writeJ3DiagnosticCheckpoint(process.cwd(), EVIDENCE_ROOT, runId, j3CheckpointSequence, ledger.j3Diagnostic);
    const failure = diagnosticFailureForWriteOutcome(outcome);
    if (failure) {
      ledger.diagnosticWriteFailure = failure;
      console.error("[platform-evaluation] J3 diagnostic checkpoint write failed code=diagnostic_write_failed");
      throw new J3ActionError("diagnostic_write_failed");
    }
    j3CheckpointSequence += 1;
  };
  const runJ3Operation = async <T>(
    operation: J3Operation,
    checkpoint: J3Checkpoint,
    action: () => Promise<T>,
    observations?: (value: T) => OwnedExecutionObservations
  ): Promise<T> => {
    ledger.j3Diagnostic = attemptJ3Operation(ledger.j3Diagnostic, operation);
    await persistJ3Diagnostic();
    let value: T;
    try {
      value = await action();
    } catch (error) {
      const failure = diagnosticFailureOf(error);
      ledger.j3Diagnostic = failJ3Operation(ledger.j3Diagnostic, failure);
      try {
        await persistJ3Diagnostic();
      } catch {
        ledger.secondaryFailures.push(safeDiagnosticFailure("diagnostic_write_failed"));
      }
      console.error(`[platform-evaluation] J3 operation failed operation=${operation} code=${failure.code}${failure.status ? ` status=${failure.status}` : ""}`);
      throw error;
    }
    ledger.j3Diagnostic = completeJ3Operation(ledger.j3Diagnostic, checkpoint, observations?.(value));
    await persistJ3Diagnostic();
    return value;
  };
  const record = async (id: JourneyId, action: () => Promise<void>) => {
    try { await action(); ledger.verdicts[id] = "passed"; }
    catch { ledger.verdicts[id] = "failed"; ledger.failedStage = id; throw new Error(`${id} failed; inspect the sanitized ledger and status evidence`); }
  };
  const sanitizedFailure = (error: unknown): Error => {
    const message = error instanceof Error ? error.message : "";
    const safeHttp = /^(GET|POST|PUT|PATCH) \/api\/[a-zA-Z0-9_./:%-]+ (returned HTTP [0-9]{3}|failed before an HTTP response)$/;
    if (safeHttp.test(message)) return new Error(message);
    return new Error(`${ledger.failedStage ?? "preservation"} failed; inspect the sanitized ledger and status evidence`);
  };

  try {
    try {
    await test.step("J1 — access, login, tenant scope, and real workflow API", () => record("J1", async () => {
      const anonymous = await request.get(api("/workflows"), { headers: { "x-yoizen-tenant": config.tenant } });
      expect(anonymous.status()).toBe(401);
      await page.goto(`${config.baseUrl}/workflows`);
      await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
      await page.getByLabel("Email").fill(config.email);
      await page.getByLabel("Password").fill(config.password);
      const tenantInput = page.getByLabel("Tenant ID");
      if (await tenantInput.isVisible().catch(() => false)) await tenantInput.fill(config.tenant);
      const loginResponse = page.waitForResponse((response) => response.url().includes("/api/auth/login") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Sign In" }).click();
      const observedLogin = await loginResponse;
      expect(observedLogin.status()).toBe(201);
      const login: unknown = await observedLogin.json();
      expect(isRow(login)).toBe(true);
      token = stringOf(login as Row, "access_token", "accessToken", "token") ?? "";
      expect(token).not.toBe("");
      expect(stringOf(decodeJwt(token), "scope")).toBe("tenant:acme");
      const restrictedClaims = decodeJwt(config.restrictedToken);
      expect(stringOf(restrictedClaims, "scope")).toBe("tenant:acme");
      const permissions = Array.isArray(restrictedClaims.permissions) ? restrictedClaims.permissions : [];
      expect(permissions).not.toContain("*");
      expect(permissions).not.toContain("tracking:payload:read");
      const restrictedProof = await request.get(api("/workflows"), { headers: authHeaders(config.restrictedToken) });
      expect(restrictedProof.status()).toBe(200);
      await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
      const workflowsResponse = page.waitForResponse((response) => response.url().includes("/api/workflows") && response.status() === 200);
      await page.goto(`${config.baseUrl}/workflows`);
      expect((await workflowsResponse).status()).toBe(200);
      const syntheticTenant = `eval-e2e-${randomUUID()}`;
      const mismatch = await request.get(api("/workflows"), { headers: authHeaders(token, syntheticTenant) });
      expect(mismatch.status()).toBe(403);
    }));

    await test.step("J2 — validate, store, plan, apply, idempotency, and typed plan failure", () => record("J2", async () => {
      const headers = authHeaders(token);
      const channelRows = rowsOf(await jsonResponse(request, "GET", api("/channels/accounts"), 200, { headers }));
      const workflowRows = rowsOf(await jsonResponse(request, "GET", api("/workflows"), 200, { headers }));
      if ([...channelRows, ...workflowRows].some((row) => stringOf(row, "name")?.startsWith(prefix))) throw new Error("Owned fixture name collision");
      baseline = { channels: snapshotResources("channel", channelRows), workflows: snapshotResources("workflow", workflowRows) };
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(`${evidenceDir}/baseline.json`, `${JSON.stringify(baseline, null, 2)}\n`, { flag: "wx" });
      const manifest = manifestFor(names.manifest, names.channel, names.sink, names.workflow);
      const validation = await jsonResponse(request, "POST", api("/provisioning/manifests/validate"), 200, { headers, data: manifest });
      expect(isRow(validation) && validation.valid).toBe(true);
      const invalid = await jsonResponse(request, "POST", api("/provisioning/manifests/validate"), 200, { headers, data: { kind: "bad" } });
      expect(isRow(invalid) && invalid.valid).toBe(false);
      const stored = await jsonResponse(request, "PUT", api(`/provisioning/manifests/${names.manifest}`), 200, { headers, data: manifest });
      expect(isRow(stored) && typeof stored.revision === "number").toBe(true);
      ledger.manifests.push({ name: names.manifest, revision: Number((stored as Row).revision), hash: semanticHash(manifest) });
      const plan = await jsonResponse(request, "POST", api(`/provisioning/manifests/${names.manifest}/plan`), 200, { headers, data: {} });
      const creates = rowsOf(plan).filter((row) => row.verdict === "create");
      expect(creates).toHaveLength(3);
      expect(isRow(plan) && Array.isArray(plan.preconditions) && plan.preconditions).toHaveLength(0);
      expect(creates.map((row) => `${row.kind}:${row.name}`).sort()).toEqual([
        `channel:${names.channel}`, `channel:${names.sink}`, `workflow:${names.workflow}`,
      ].sort());
      const expectedResources = [
        { kind: "channel" as const, name: names.channel },
        { kind: "channel" as const, name: names.sink },
        { kind: "workflow" as const, name: names.workflow },
      ];
      const appliedResponse = await jsonResponseWithStatus(request, "POST", api(`/provisioning/manifests/${names.manifest}/apply`), [200, 409], { headers, data: {} });
      const appliedInspection = inspectApplyResponse(appliedResponse.status, appliedResponse.body, expectedResources);
      ledger.channelIds = appliedInspection.captured.filter(({ kind }) => kind === "channel").map(({ id }) => id);
      ledger.workflowId = appliedInspection.captured.find(({ kind }) => kind === "workflow")?.id;
      await writeFile(`${evidenceDir}/apply-capture.json`, `${JSON.stringify({ status: appliedResponse.status, captured: appliedInspection.captured, issues: appliedInspection.issues }, null, 2)}\n`, { flag: "wx" });
      for (const captured of appliedInspection.captured) {
        const resource = await jsonResponse(request, "GET", api(captured.kind === "channel" ? `/channels/accounts/${captured.id}` : `/workflows/${captured.id}`), 200, { headers });
        if (captured.kind === "workflow") {
          const authority = workflowMutationAuthority(captured.id, resource, captured.name, config.tenant);
          expect(authority.ok).toBe(true);
          if (authority.ok) verifiedWorkflowId = authority.id;
        } else {
          expect(isRow(resource) && resource.id).toBe(captured.id);
          expect(isRow(resource) && resource.name).toBe(captured.name);
          expect(isRow(resource) && stringOf(resource, "tenantId", "tenant_id")).toBe(config.tenant);
        }
      }
      expect(appliedResponse.status).toBe(200);
      expect(appliedInspection.issues).toEqual([]);
      expect(isRow(appliedResponse.body) && appliedResponse.body.appliedCount).toBe(3);
      expect(isRow(appliedResponse.body) && appliedResponse.body.noopCount).toBe(0);
      expect(ledger.channelIds).toHaveLength(2);
      expect(ledger.workflowId && isNanoId(ledger.workflowId)).toBe(true);
      const storedAgain = await jsonResponse(request, "PUT", api(`/provisioning/manifests/${names.manifest}`), 200, { headers, data: manifest });
      expect(isRow(storedAgain) && typeof storedAgain.revision === "number" && storedAgain.revision > Number((stored as Row).revision)).toBe(true);
      ledger.manifests[0] = { name: names.manifest, revision: Number((storedAgain as Row).revision), hash: semanticHash(manifest) };
      const secondPlan = await jsonResponse(request, "POST", api(`/provisioning/manifests/${names.manifest}/plan`), 200, { headers, data: {} });
      expect(rowsOf(secondPlan).filter((row) => row.verdict !== "noop")).toHaveLength(0);
      expect(rowsOf(secondPlan).map((row) => `${row.kind}:${row.name}`).sort()).toEqual(creates.map((row) => `${row.kind}:${row.name}`).sort());
      const secondApply = await jsonResponse(request, "POST", api(`/provisioning/manifests/${names.manifest}/apply`), 200, { headers, data: {} });
      expect(isRow(secondApply) && secondApply.appliedCount).toBe(0);
      expect(isRow(secondApply) && secondApply.noopCount).toBe(3);
      const stableInspection = inspectApplyResponse(200, secondApply, expectedResources);
      expect(stableInspection.issues).toEqual([]);
      expect(stableInspection.captured.map(({ id }) => id).sort()).toEqual(appliedInspection.captured.map(({ id }) => id).sort());
      const unresolved = unresolvedManifestFor(names.invalid, `${prefix}-invalid-workflow`);
      const storedInvalid = await jsonResponse(request, "PUT", api(`/provisioning/manifests/${names.invalid}`), 200, { headers, data: unresolved });
      ledger.manifests.push({ name: names.invalid, revision: Number(isRow(storedInvalid) ? storedInvalid.revision : 0), hash: semanticHash(unresolved) });
      const failedPlan = await jsonResponse(request, "POST", api(`/provisioning/manifests/${names.invalid}/plan`), 200, { headers, data: {} });
      expect(isRow(failedPlan) && Array.isArray(failedPlan.preconditions) && failedPlan.preconditions.length).toBeGreaterThan(0);
      expect(canonical(failedPlan)).toContain("unresolvable_external_ref");
      expect(canonical(failedPlan)).toContain("missing-owned-channel");
      const currentChannels = snapshotResources("channel", rowsOf(await jsonResponse(request, "GET", api("/channels/accounts"), 200, { headers })));
      const currentWorkflows = snapshotResources("workflow", rowsOf(await jsonResponse(request, "GET", api("/workflows"), 200, { headers })));
      expect(sameSnapshot(baseline.channels, withoutOwned(currentChannels, ledger.channelIds))).toBe(true);
      expect(sameSnapshot(baseline.workflows, withoutOwned(currentWorkflows, [ledger.workflowId!]))).toBe(true);
    }));

    await test.step("J3 — owned ingress, execution, branch, and sink event", () => record("J3", async () => {
      const headers = authHeaders(token);
      const accountAccess = await runJ3Operation("account_validation", "account_validated", async () => {
        const account = await jsonResponse(request, "GET", api(`/channels/accounts/${ledger.channelIds[0]}`), 200, { headers });
        if (!isRow(account)) throw new J3ActionError("malformed_response");
        const secret = stringOf(account, "appSecret") ?? "";
        const resolution = resolveInboundAccount(ledger.channelIds[0], {
          id: account.id,
          name: account.name,
          tenantId: stringOf(account, "tenantId", "tenant_id"),
          channel: account.channel,
          externalId: account.externalId,
          isActive: account.isActive,
          hasSecret: secret.trim().length > 0,
        }, names.channel, config.tenant);
        if (!resolution.ok) throw new J3ActionError("ownership_mismatch");
        return { resolution, secret };
      });
      appSecret = accountAccess.secret;
      expect(appSecret).not.toBe("");
      inboundWebhookPath = `/webhooks/http/${config.tenant}/${accountAccess.resolution.encodedInstance}`;
      const nonce = `${prefix}-first`;
      const ingress = await runJ3Operation("ingress_publication", "ingress_published", async () => {
        const value = await jsonResponse(request, "POST", api(inboundWebhookPath!), 200, { headers: { "x-http-channel-token": appSecret }, data: { from: `${prefix}-actor`, text: nonce } });
        if (!isRow(value) || typeof value.status !== "string") throw new J3ActionError("malformed_response");
        expect(value.status).toBe("accepted");
        return value;
      });
      expect(isRow(ingress) && ingress.status).toBe("accepted");
      await runJ3Operation("execution_list_observation", "execution_list_observed", async () => {
        const list = await jsonResponse(request, "GET", api(`/workflows/${ledger.workflowId}/executions?pageSize=100`), 200, { headers });
        if (!Array.isArray(list) && (!isRow(list) || !Array.isArray(list.items))) throw new J3ActionError("malformed_response");
        return rowsOf(list);
      }, (rows) => observeOwnedExecutions(rows, nonce));
      firstExecution = await runJ3Operation("execution_completion_observation", "execution_completed", async () => {
        const execution = await poll(async () => {
          const list = await jsonResponse(request, "GET", api(`/workflows/${ledger.workflowId}/executions?pageSize=100`), 200, { headers });
          if (!Array.isArray(list) && (!isRow(list) || !Array.isArray(list.items))) throw new J3ActionError("malformed_response");
          const rows = rowsOf(list);
          ledger.j3Diagnostic = updateJ3Observations(ledger.j3Diagnostic, observeOwnedExecutions(rows, nonce));
          await persistJ3Diagnostic();
          return rows.find((row) => canonical(row).includes(nonce) && stringOf(row, "status") === "COMPLETED");
        }, "owned workflow execution");
        expect(isNanoId(stringOf(execution, "id") ?? "")).toBe(true);
        return execution;
      }, (execution) => observeOwnedExecutions([execution], nonce));
      const executionId = stringOf(firstExecution, "id") ?? "";
      expect(isNanoId(executionId)).toBe(true);
      ledger.executionIds.push(executionId);
      const detail = await runJ3Operation("detail_validation", "detail_validated", async () => {
        const value = await jsonResponse(request, "GET", api(`/workflows/${ledger.workflowId}/executions/${executionId}`), 200, { headers });
        if (!isRow(value)) throw new J3ActionError("malformed_response");
        expect(canonical(value)).toContain(nonce);
        const results = isRow(value.result) && isRow(value.result.results) ? value.result.results : {};
        expect(results.compute).toEqual({ nonce, branch: "expected" });
        return value;
      });
      const causal = isRow(detail) && isRow(detail.result) && isRow(detail.result.causal) ? detail.result.causal : {};
      const correlation = await runJ3Operation("correlation_capture", "correlation_captured", async () => {
        const value = stringOf(causal, "correlation_id", "correlationId") ?? "";
        expect(value).toMatch(UUID);
        return value;
      });
      ledger.correlationIds.push(correlation);
      const run = await runJ3Operation("tracking_run_observation", "tracking_run_observed", async () => {
        const value = await poll(async () => {
          const workflowId = stringOf(firstExecution!, "temporalWorkflowId", "temporal_workflow_id");
          const runIdValue = stringOf(firstExecution!, "temporalRunId", "temporal_run_id");
          let transport: SafeTransportResult<APIResponse>;
          try {
            transport = normalizeTransportOutcome({ ok: true, value: await request.get(api(`/tracking/runs/${encodeURIComponent(workflowId!)}/${encodeURIComponent(runIdValue!)}`), { headers }) });
          } catch {
            transport = normalizeTransportOutcome<APIResponse>({ ok: false });
          }
          if (transport.ok === false) throw new J3ActionError(transport.failure.code);
          const response = transport.value;
          if (response.status() === 404) return undefined;
          if (response.status() !== 200) throw new Error(`GET /api/tracking/runs returned HTTP ${response.status()}`);
          const body: unknown = await response.json();
          if (!isRow(body)) throw new J3ActionError("malformed_response");
          return canonical(body).includes("send-owned") ? body : undefined;
        }, "tracking run details");
        const serializedValue = canonical(value);
        expect(serializedValue).toContain("expected-branch");
        expect(serializedValue).not.toContain("false-step");
        return value;
      });
      const serialized = canonical(run);
      expect(serialized).toContain("expected-branch");
      expect(serialized).not.toContain("false-step");
      const chain = await runJ3Operation("sent_event_observation", "sent_event_observed", async () => {
        const value = await poll(async () => {
          const observed = await jsonResponse(request, "GET", api(`/tracking/chains/${correlation}`), 200, { headers });
          if (!isRow(observed)) throw new J3ActionError("malformed_response");
          return rowsOf(observed).some((row) => row.kind === "sent") ? observed : undefined;
        }, "tracking chain sent event");
        const observedSent = rowsOf(value).filter((row) => row.kind === "sent");
        expect(observedSent).toHaveLength(1);
        expect(stringOf(observedSent[0]!, "subject")).toContain(".e2e-tests.");
        return value;
      });
      const sent = rowsOf(chain).filter((row) => row.kind === "sent");
      expect(sent).toHaveLength(1);
      expect(stringOf(sent[0]!, "subject")).toContain(".e2e-tests.");
    }));

    await test.step("J4 — exact-ID disable refusal, re-enable, and final disable", () => record("J4", async () => {
      const headers = authHeaders(token);
      expect(verifiedWorkflowId).toBe(ledger.workflowId);
      const since = new Date().toISOString();
      await jsonResponse(request, "PATCH", api(`/workflows/${verifiedWorkflowId}/status`), 200, { headers, data: { status: "disabled" } });
      const beforeIds = new Set(rowsOf(await jsonResponse(request, "GET", api(`/workflows/${ledger.workflowId}/executions?pageSize=100`), 200, { headers })).map((row) => stringOf(row, "id")));
      expect(inboundWebhookPath).toBeDefined();
      await jsonResponse(request, "POST", api(inboundWebhookPath!), 200, { headers: { "x-http-channel-token": appSecret }, data: { from: `${prefix}-actor`, text: `${prefix}-disabled` } });
      const expectedWarning = `Skipped trigger for disabled workflow ${names.workflow} (${ledger.workflowId})`;
      const warningSeen = await poll(async () => {
        const { stdout } = await execFileAsync("kubectl", ["--context", "orbstack", "-n", "platform-services-dev", "logs", "-l", "app.kubernetes.io/name=workflow-service-worker", `--since-time=${since}`], { maxBuffer: 4 * 1024 * 1024 });
        return stdout.includes(expectedWarning) ? true : undefined;
      }, "disabled-workflow refusal warning");
      expect(warningSeen).toBe(true);
      const refusalDeadline = Date.now() + POLL_LIMIT_MS;
      while (Date.now() < refusalDeadline) {
        const observed = rowsOf(await jsonResponse(request, "GET", api(`/workflows/${ledger.workflowId}/executions?pageSize=100`), 200, { headers }));
        expect(observed.every((row) => beforeIds.has(stringOf(row, "id")))).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      await jsonResponse(request, "PATCH", api(`/workflows/${verifiedWorkflowId}/status`), 200, { headers, data: { status: "enabled" } });
      const nonce = `${prefix}-reenabled`;
      await jsonResponse(request, "POST", api(inboundWebhookPath!), 200, { headers: { "x-http-channel-token": appSecret }, data: { from: `${prefix}-actor`, text: nonce } });
      const execution = await poll(async () => rowsOf(await jsonResponse(request, "GET", api(`/workflows/${ledger.workflowId}/executions?pageSize=100`), 200, { headers })).find((row) => canonical(row).includes(nonce) && stringOf(row, "status") === "COMPLETED"), "re-enabled execution");
      const executionId = stringOf(execution, "id") ?? "";
      expect(isNanoId(executionId)).toBe(true);
      ledger.executionIds.push(executionId);
      await jsonResponse(request, "PATCH", api(`/workflows/${verifiedWorkflowId}/status`), 200, { headers, data: { status: "disabled" } });
      ledger.finallyDisable = "disabled";
    }));

    await test.step("J5 — trace and run UI, causal APIs, and guarded payload", () => record("J5", async () => {
      const headers = authHeaders(token);
      const correlation = ledger.correlationIds[0];
      const temporalWorkflowId = stringOf(firstExecution!, "temporalWorkflowId", "temporal_workflow_id") ?? "";
      const temporalRunId = stringOf(firstExecution!, "temporalRunId", "temporal_run_id") ?? "";
      expect(temporalWorkflowId).not.toBe("");
      expect(temporalRunId).not.toBe("");
      const chain = await jsonResponse(request, "GET", api(`/tracking/chains/${correlation}`), 200, { headers });
      const run = await jsonResponse(request, "GET", api(`/tracking/runs/${encodeURIComponent(temporalWorkflowId)}/${encodeURIComponent(temporalRunId)}`), 200, { headers });
      expect(isRow(run) && isRow(run.summary) && run.summary.status).toBe("completed");
      expect(isRow(run) && run.workflow_id).toBe(temporalWorkflowId);
      expect(isRow(run) && run.run_id).toBe(temporalRunId);
      expect(isRow(run) && run.correlation_id).toBe(correlation);
      expect(isRow(run) && run.step_detail).toBe(true);
      expect(isRow(run) && Array.isArray(run.spans) && run.spans.length).toBeGreaterThan(0);
      expect(isRow(run) && isRow(run.summary) && run.summary.steps_failed).toBe(0);
      expect(isRow(run) && isRow(run.summary) && Number(run.summary.steps_ok)).toBeGreaterThanOrEqual(3);
      const runEvents = isRow(run) && Array.isArray(run.events) ? run.events.filter(isRow) : [];
      const completedNames = runEvents.filter((row) => row.kind === "action_completed" && row.payload_step_status === "ok").map((row) => row.payload_action_name);
      expect(completedNames).toEqual(expect.arrayContaining(["compute", "route", "send-owned"]));
      expect(canonical(runEvents)).toContain("expected-branch");
      expect(canonical(runEvents)).not.toContain("false-step");
      const events = isRow(chain) && Array.isArray(chain.events) ? chain.events.filter(isRow) : [];
      const ids = new Set(events.map((row) => stringOf(row, "event_id", "id")).filter(Boolean));
      expect(events.every((row) => !stringOf(row, "causation_id", "causationId") || ids.has(stringOf(row, "causation_id", "causationId")))).toBe(true);
      expect(isRow(chain) && chain.correlation_id).toBe(correlation);
      expect(isRow(chain) && isRow(chain.summary) && chain.summary.orphan_count).toBe(0);
      await page.goto(`${config.baseUrl}/workflows/${ledger.workflowId}`);
      await expect(page.getByText(names.workflow, { exact: false }).first()).toBeVisible();
      await page.goto(`${config.baseUrl}/processes/trace/${correlation}`);
      await expect(page.getByText(correlation, { exact: false }).first()).toBeVisible();
      await page.goto(`${config.baseUrl}/processes/runs/${encodeURIComponent(temporalWorkflowId)}/${encodeURIComponent(temporalRunId)}`);
      await expect(page.getByText(/completed/i).first()).toBeVisible();
      await expect(page.getByText(/compute|route|send-owned/i).first()).toBeVisible();
      const ingressEvent = events.find((row) => row.kind === "webhook_received");
      const ingressId = ingressEvent ? stringOf(ingressEvent, "event_id", "id") : undefined;
      expect(ingressId).toMatch(UUID);
      const payload = await jsonResponse(request, "GET", api(`/tracking/chains/${correlation}/events/${ingressId}/payload`), 200, { headers });
      expect(canonical(payload)).toContain(`${prefix}-first`);
      const sentEvent = events.find((row) => row.kind === "sent");
      const sentId = sentEvent ? stringOf(sentEvent, "event_id", "id") : undefined;
      expect(sentId).toMatch(UUID);
      const sentPayload = await jsonResponse(request, "GET", api(`/tracking/chains/${correlation}/events/${sentId}/payload`), 200, { headers });
      expect(canonical(sentPayload)).toContain(`${prefix}-first`);
      expect(canonical(sentPayload)).toContain(`recipient-${names.manifest}`);
      const unknown = await request.get(api(`/tracking/chains/${correlation}/events/00000000-0000-0000-0000-000000000000/payload`), { headers });
      expect(unknown.status()).toBe(404);
      const denied = await request.get(api(`/tracking/chains/${correlation}/events/${ingressId}/payload`), { headers: authHeaders(config.restrictedToken) });
      expect(denied.status()).toBe(403);
    }));
    } catch (error) {
      primaryError = error;
    }
  } finally {
    if (ledger.workflowId && token) {
      try {
        const resource = await jsonResponse(request, "GET", api(`/workflows/${ledger.workflowId}`), 200, { headers: authHeaders(token) });
        const authority = workflowMutationAuthority(ledger.workflowId, resource, names.workflow, config.tenant);
        if (!authority.ok) throw new Error("captured workflow did not grant mutation authority");
        await jsonResponse(request, "PATCH", api(`/workflows/${authority.id}/status`), 200, { headers: authHeaders(token), data: { status: "disabled" } });
        ledger.finallyDisable = "disabled";
        ledger.finallyDisableEvidence = { status: 200, state: "disabled" };
      } catch {
        const failure = safeDiagnosticFailure("safety_disable_failed");
        ledger.finallyDisable = "failed";
        ledger.finallyDisableEvidence = { state: "failed", reason: "verification-or-request-failed" };
        ledger.failedStage = safetyFailureStage(ledger.failedStage);
        if (primaryError !== undefined) ledger.secondaryFailures.push(failure);
        console.error("[platform-evaluation] safety finalization failed code=safety_disable_failed");
        primaryError = preservePrimaryFailure(primaryError, new Error("workflow safety disable failed"));
      }
    }
    if (baseline && token) {
      try {
        const channels = snapshotResources("channel", rowsOf(await jsonResponse(request, "GET", api("/channels/accounts"), 200, { headers: authHeaders(token) })));
        const workflows = snapshotResources("workflow", rowsOf(await jsonResponse(request, "GET", api("/workflows"), 200, { headers: authHeaders(token) })));
        expect(sameSnapshot(baseline.channels, withoutOwned(channels, ledger.channelIds))).toBe(true);
        expect(sameSnapshot(baseline.workflows, withoutOwned(workflows, ledger.workflowId ? [ledger.workflowId] : []))).toBe(true);
        const preservation = preservationState(ledger.verdicts, ledger.failedStage === "preservation" ? undefined : ledger.failedStage, true);
        ledger.preservation = preservation.preservation;
        ledger.retained = [
          ...ledger.channelIds.map((id) => ({ kind: "channel", id, hash: channels.find((row) => row.id === id)?.hash ?? "missing", status: "retained" })),
          ...(ledger.workflowId ? [{ kind: "workflow", id: ledger.workflowId, hash: workflows.find((row) => row.id === ledger.workflowId)?.hash ?? "missing", status: ledger.finallyDisable }] : []),
          ...ledger.manifests.map(({ name, revision, hash }) => ({ kind: "manifest", id: `${name}@${revision}`, hash, status: "retained" })),
        ];
      } catch (error) {
        const failure = safeDiagnosticFailure("preservation_failed");
        const preservation = preservationState(ledger.verdicts, ledger.failedStage === "preservation" ? undefined : ledger.failedStage, false);
        ledger.verdicts = { ...preservation.verdicts };
        ledger.failedStage = preservation.failedStage;
        ledger.preservation = preservation.preservation;
        if (primaryError !== undefined) ledger.secondaryFailures.push(failure);
        console.error("[platform-evaluation] resource preservation failed code=preservation_failed");
        primaryError = preservePrimaryFailure(primaryError, error);
      }
    }
    ledger.finishedAt = new Date().toISOString();
    try {
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(`${evidenceDir}/ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`, { flag: "wx" });
    } catch {
      if (primaryError !== undefined) ledger.secondaryFailures.push(safeDiagnosticFailure("ledger_write_failed"));
      console.error("[platform-evaluation] final ledger write failed code=ledger_write_failed");
      primaryError = preservePrimaryFailure(primaryError, new Error("final ledger write failed"));
    }
  }
  if (primaryError !== undefined) throw sanitizedFailure(primaryError);
  expect(Object.values(ledger.verdicts)).toEqual(["passed", "passed", "passed", "passed", "passed"]);
});
