import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, symlink } from "node:fs/promises";
import test from "node:test";
import { attemptJ3Operation, completeJ3Operation, diagnosticFailureForWriteOutcome, failJ3Operation, initialJ3Diagnostic, inspectApplyResponse, isNanoId, isUuid, normalizeTransportOutcome, observeOwnedExecutions, preservationState, preservePrimaryFailure, resolveInboundAccount, safeDiagnosticFailure, safetyFailureStage, sameSnapshot, snapshotResources, updateJ3Observations, workflowMutationAuthority, writeJ3DiagnosticCheckpoint } from "./platform-evaluation-state.ts";

const uuid1 = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const nano = "cQWmpX1yymKmeVL3l9ZnB";
const expected = [
  { kind: "channel", name: "in" },
  { kind: "channel", name: "out" },
  { kind: "workflow", name: "flow" },
];
const resource = (kind, name, externalId) => ({ kind, name, verdict: "create", externalId });

test("per-kind validators accept canonical platform IDs", () => {
  assert.equal(isUuid(uuid1), true);
  assert.equal(isUuid(nano), false);
  assert.equal(isNanoId(nano), true);
  assert.equal(isNanoId(uuid1), false);
  assert.equal(isNanoId("short"), false);
});

test("HTTP 200 captures two channels and one workflow before count assertions", () => {
  const result = inspectApplyResponse(200, { resources: [resource("channel", "in", uuid1), resource("channel", "out", uuid2), resource("workflow", "flow", nano)], appliedCount: 99 }, expected);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.captured.map(({ kind, name, id }) => [kind, name, id]), [["channel", "in", uuid1], ["channel", "out", uuid2], ["workflow", "flow", nano]]);
});

for (const [label, applied, ids] of [
  ["empty", [], []],
  ["one channel", [resource("channel", "in", uuid1)], [uuid1]],
  ["channel and workflow", [resource("channel", "in", uuid1), resource("workflow", "flow", nano)], [uuid1, nano]],
]) {
  test(`HTTP 409 captures ${label} applied resources`, () => {
    const result = inspectApplyResponse(409, { error: { applied } }, expected);
    assert.deepEqual(result.captured.map(({ id }) => id), ids);
  });
}

test("malformed and swapped per-kind IDs are rejected", () => {
  const malformed = inspectApplyResponse(200, { resources: [resource("channel", "in", nano), resource("workflow", "flow", uuid1)] }, expected);
  assert.deepEqual(malformed.captured, []);
  assert.deepEqual(malformed.issues, ["invalid channel ID for in", "invalid workflow ID for flow"]);
});

test("unknown names, duplicate pairs, and wrong kinds are never adopted", () => {
  const result = inspectApplyResponse(200, { resources: [
    resource("channel", "in", uuid1), resource("channel", "in", uuid2),
    resource("channel", "flow", uuid1), resource("workflow", "unknown", nano),
  ] }, expected);
  assert.deepEqual(result.captured, []);
  assert.deepEqual(result.issues, ["duplicate apply resource channel:in", "unknown apply resource workflow:unknown", "wrong kind for flow"]);
});

test("safe snapshots are sorted, immutable, and sensitive-field independent", () => {
  const source = [{ id: uuid2, name: "b", appSecret: "first" }, { id: uuid1, name: "a", appSecret: "second" }];
  const before = structuredClone(source);
  const snapshot = snapshotResources("channel", source);
  assert.deepEqual(source, before);
  assert.deepEqual(snapshot.map(({ id }) => id), [uuid1, uuid2]);
  const changedSecrets = source.map((row) => ({ ...row, appSecret: "changed" }));
  assert.equal(sameSnapshot(snapshot, snapshotResources("channel", changedSecrets)), true);
  assert.deepEqual(snapshotResources("workflow", [{ id: nano, name: "flow" }, { id: uuid1, name: "wrong-id-kind" }]).map(({ id }) => id), [nano]);
});

test("primary J2 failure survives preservation failure and J5 remains pending", () => {
  const verdicts = { J1: "passed", J2: "failed", J3: "pending", J4: "pending", J5: "pending" };
  const result = preservationState(verdicts, "J2", false);
  assert.equal(result.failedStage, "J2");
  assert.equal(result.preservation, "failed");
  assert.equal(result.verdicts.J5, "pending");
  assert.deepEqual(verdicts, { J1: "passed", J2: "failed", J3: "pending", J4: "pending", J5: "pending" });
});

test("captured workflow ID grants mutation authority only after an exact resource match", () => {
  const exact = { id: nano, name: "flow", tenantId: "acme" };
  assert.equal(workflowMutationAuthority(nano, undefined, "flow", "acme").ok, false);
  assert.deepEqual(workflowMutationAuthority(nano, exact, "flow", "acme"), { ok: true, id: nano });
  assert.equal(workflowMutationAuthority(nano, { ...exact, id: "differentNanoIdValue1" }, "flow", "acme").ok, false);
  assert.equal(workflowMutationAuthority(nano, { ...exact, name: "other" }, "flow", "acme").ok, false);
  assert.equal(workflowMutationAuthority(nano, { ...exact, tenantId: "other" }, "flow", "acme").ok, false);
});

test("safety failure becomes primary only when no journey failure exists", () => {
  assert.equal(safetyFailureStage(undefined), "safety");
  assert.equal(safetyFailureStage("J2"), "J2");
  assert.equal(preservationState({ J1: "passed", J2: "passed", J3: "passed", J4: "passed", J5: "passed" }, "safety", false).failedStage, "safety");
});

const inboundAccount = (overrides = {}) => ({
  id: uuid1,
  name: "in",
  tenantId: "acme",
  channel: "http",
  externalId: "instance/% ? café",
  isActive: true,
  hasSecret: true,
  ...overrides,
});

test("owned inbound account resolves UUID identity to one encoded external-ID segment", () => {
  const result = resolveInboundAccount(uuid1, inboundAccount({ appSecret: "do-not-retain" }), "in", "acme");
  assert.deepEqual(result, {
    ok: true,
    accountId: uuid1,
    externalId: "instance/% ? café",
    encodedInstance: "instance%2F%25%20%3F%20caf%C3%A9",
  });
  assert.notEqual(result.ok && result.encodedInstance, uuid1);
  assert.equal(JSON.stringify(result).includes("do-not-retain"), false);
});

for (const [label, capturedId, account, code] of [
  ["malformed account", uuid1, undefined, "malformed_account"],
  ["malformed captured ID", "not-a-uuid", inboundAccount(), "malformed_account"],
  ["wrong ID", uuid1, inboundAccount({ id: uuid2 }), "account_id_mismatch"],
  ["wrong name", uuid1, inboundAccount({ name: "other" }), "account_name_mismatch"],
  ["wrong tenant", uuid1, inboundAccount({ tenantId: "other" }), "account_tenant_mismatch"],
  ["wrong channel", uuid1, inboundAccount({ channel: "telegram" }), "account_channel_mismatch"],
  ["inactive", uuid1, inboundAccount({ isActive: false }), "account_inactive"],
  ["missing external ID", uuid1, inboundAccount({ externalId: "" }), "account_external_id_missing"],
  ["blank external ID", uuid1, inboundAccount({ externalId: "  " }), "account_external_id_missing"],
  ["current-directory external ID", uuid1, inboundAccount({ externalId: "." }), "account_external_id_invalid"],
  ["parent-directory external ID", uuid1, inboundAccount({ externalId: ".." }), "account_external_id_invalid"],
  ["lone high-surrogate external ID", uuid1, inboundAccount({ externalId: "\ud800" }), "account_external_id_invalid"],
  ["lone low-surrogate external ID", uuid1, inboundAccount({ externalId: "\udfff" }), "account_external_id_invalid"],
  ["missing secret", uuid1, inboundAccount({ hasSecret: false }), "account_secret_missing"],
]) {
  test(`inbound account resolution rejects ${label} without adopting another account`, () => {
    assert.deepEqual(resolveInboundAccount(capturedId, account, "in", "acme"), { ok: false, code });
  });
}

test("J3 diagnostics distinguish attempted operation, completed checkpoint, and safe observations", () => {
  const attempted = attemptJ3Operation(initialJ3Diagnostic(), "ingress_publication");
  assert.equal(attempted.attemptedOperation, "ingress_publication");
  assert.equal(attempted.lastCompletedCheckpoint, "none");
  const observed = observeOwnedExecutions([
    { id: nano, status: "RUNNING", input: { text: "owned-marker" } },
    { id: "anotherValidNanoId123", status: "COMPLETED", input: { text: "owned-marker" } },
    { id: uuid1, status: "COMPLETED", input: { text: "owned-marker" } },
    { id: "thirdValidNanoIdValue", status: "SECRET-shaped-status", input: { text: "owned-marker" } },
    { id: "fourthValidNanoIdValu", status: "FAILED", input: { text: "other" } },
  ], "owned-marker");
  const completed = completeJ3Operation(attempted, "execution_list_observed", observed);
  assert.deepEqual(completed.observations, {
    count: 3,
    executionIds: ["anotherValidNanoId123", nano, "thirdValidNanoIdValue"].sort(),
    completedExecutionIds: ["anotherValidNanoId123"],
    statusCounts: { RUNNING: 1, COMPLETED: 1, unknown: 1 },
  });
  assert.equal(completed.lastCompletedCheckpoint, "execution_list_observed");
});

test("diagnostic failures expose only allowlisted codes and valid numeric HTTP status", () => {
  const sensitive = "token=do-not-persist appSecret=do-not-persist nonce=do-not-persist";
  const failed = failJ3Operation(initialJ3Diagnostic(), safeDiagnosticFailure("http_error", 503));
  assert.deepEqual(failed.failure, { code: "http_error", status: 503 });
  assert.deepEqual(safeDiagnosticFailure("http_error", 999), { code: "http_error" });
  assert.deepEqual(safeDiagnosticFailure("token=do-not-persist", "503"), { code: "assertion_failed" });
  assert.equal(JSON.stringify({ failed, secondary: safeDiagnosticFailure("diagnostic_write_failed") }).includes(sensitive), false);
});

test("J3 checkpoint sequence records each attempt before advancing and retains failures at the last success", () => {
  const sequence = [
    ["account_validation", "account_validated"],
    ["ingress_publication", "ingress_published"],
    ["execution_list_observation", "execution_list_observed"],
    ["execution_completion_observation", "execution_completed"],
    ["detail_validation", "detail_validated"],
    ["correlation_capture", "correlation_captured"],
    ["tracking_run_observation", "tracking_run_observed"],
    ["sent_event_observation", "sent_event_observed"],
  ];
  let state = initialJ3Diagnostic();
  for (const [operation, checkpoint] of sequence) {
    const previous = state.lastCompletedCheckpoint;
    state = attemptJ3Operation(state, operation);
    assert.equal(state.attemptedOperation, operation);
    assert.equal(state.lastCompletedCheckpoint, previous);
    const failed = failJ3Operation(state, safeDiagnosticFailure("timeout"));
    assert.equal(failed.lastCompletedCheckpoint, previous);
    assert.deepEqual(failed.failure, { code: "timeout" });
    state = completeJ3Operation(state, checkpoint);
  }
  assert.equal(state.lastCompletedCheckpoint, "sent_event_observed");
});

test("safe diagnostic failure vocabulary covers every boundary without carrying raw input", () => {
  for (const code of ["transport_error", "http_error", "malformed_response", "ownership_mismatch", "timeout", "assertion_failed", "diagnostic_write_failed", "safety_disable_failed", "preservation_failed", "ledger_write_failed"]) {
    assert.deepEqual(safeDiagnosticFailure(code), { code });
  }
});

test("rejected tracking transport normalizes to the allowlisted transport failure", () => {
  assert.deepEqual(normalizeTransportOutcome({ ok: false }), { ok: false, failure: { code: "transport_error" } });
  const response = { status: 200 };
  assert.deepEqual(normalizeTransportOutcome({ ok: true, value: response }), { ok: true, value: response });
});

test("completion evidence remains distinct from pre-completion owned observations", () => {
  const running = observeOwnedExecutions([{ id: nano, status: "RUNNING", request: "marker" }], "marker");
  const completed = observeOwnedExecutions([{ id: nano, status: "COMPLETED", request: "marker" }], "marker");
  assert.deepEqual(running.executionIds, [nano]);
  assert.deepEqual(running.completedExecutionIds, []);
  assert.deepEqual(completed.completedExecutionIds, [nano]);
});

test("completion timeout retains the latest safe owned observations after an initially empty list", () => {
  const runningId = "runningExecutionId001";
  const failedId = "failedExecutionId0001";
  let state = completeJ3Operation(initialJ3Diagnostic(), "execution_list_observed", observeOwnedExecutions([], "sensitive-nonce"));
  state = attemptJ3Operation(state, "execution_completion_observation");
  state = updateJ3Observations(state, observeOwnedExecutions([
    { id: runningId, status: "RUNNING", request: { text: "sensitive-nonce" } },
    { id: failedId, status: "FAILED", request: { text: "sensitive-nonce" } },
  ], "sensitive-nonce"));
  state = failJ3Operation(state, safeDiagnosticFailure("timeout"));
  assert.equal(state.lastCompletedCheckpoint, "execution_list_observed");
  assert.equal(state.attemptedOperation, "execution_completion_observation");
  assert.deepEqual(state.failure, { code: "timeout" });
  assert.deepEqual(state.observations, {
    count: 2,
    executionIds: [failedId, runningId].sort(),
    completedExecutionIds: [],
    statusCounts: { RUNNING: 1, FAILED: 1 },
  });
  assert.equal(JSON.stringify(state).includes("sensitive-nonce"), false);
});

test("diagnostic checkpoint writer persists only allowlisted immutable evidence and returns typed failures", async () => {
  const evidenceRoot = "manual-loops/architecture/platform-evaluation-j3-offline-continuation/evidence/checkpoint-boundary";
  const runId = randomUUID();
  await mkdir(evidenceRoot, { recursive: true });
  const state = {
    ...completeJ3Operation(attemptJ3Operation(initialJ3Diagnostic(), "execution_list_observation"), "execution_list_observed", {
      count: 1,
      executionIds: [nano, "token=do-not-persist"],
      completedExecutionIds: [],
      statusCounts: { RUNNING: 1, "appSecret=do-not-persist": 9 },
    }),
    unexpected: { token: "do-not-persist", body: "nonce=do-not-persist" },
  };
  const written = await writeJ3DiagnosticCheckpoint(process.cwd(), evidenceRoot, runId, 0, state);
  assert.equal(written.ok, true);
  const expectedBytes = `${JSON.stringify({
    journey: "J3",
    attemptedOperation: "execution_list_observation",
    lastCompletedCheckpoint: "execution_list_observed",
    observations: { count: 1, executionIds: [nano], completedExecutionIds: [], statusCounts: { RUNNING: 1 } },
  }, null, 2)}\n`;
  assert.equal(await readFile(written.path, "utf8"), expectedBytes);
  assert.deepEqual(await writeJ3DiagnosticCheckpoint(process.cwd(), evidenceRoot, runId, 0, initialJ3Diagnostic()), { ok: false, code: "checkpoint_exists" });
  assert.equal(await readFile(written.path, "utf8"), expectedBytes);

  await mkdir(`${evidenceRoot}/${runId}/j3-checkpoint-001.json`);
  const writeFailure = await writeJ3DiagnosticCheckpoint(process.cwd(), evidenceRoot, runId, 1, initialJ3Diagnostic());
  assert.deepEqual(writeFailure, { ok: false, code: "write_failed" });
  assert.equal(await readFile(written.path, "utf8"), expectedBytes);
  await symlink("/tmp/platform-evaluation-j3-escape", `${evidenceRoot}/${runId}/j3-checkpoint-002.json`);
  assert.deepEqual(await writeJ3DiagnosticCheckpoint(process.cwd(), evidenceRoot, runId, 2, initialJ3Diagnostic()), { ok: false, code: "unsafe_destination" });
  assert.deepEqual(await writeJ3DiagnosticCheckpoint(process.cwd(), evidenceRoot, "../escape", 3, initialJ3Diagnostic()), { ok: false, code: "unsafe_destination" });

  const artifactRoot = `${evidenceRoot}/${runId}`;
  const emptyEscapeTarget = `${artifactRoot}-outside`;
  await symlink(`../${runId}-outside`, `${artifactRoot}/alias`);
  assert.deepEqual(
    await writeJ3DiagnosticCheckpoint(artifactRoot, "alias/checkpoints", uuid2, 0, initialJ3Diagnostic()),
    { ok: false, code: "unsafe_destination" },
  );
  await assert.rejects(lstat(emptyEscapeTarget), (error) => error?.code === "ENOENT");

  const primary = { code: "timeout" };
  const persistenceFailure = diagnosticFailureForWriteOutcome(writeFailure);
  assert.deepEqual(persistenceFailure, { code: "diagnostic_write_failed" });
  assert.equal(preservePrimaryFailure(primary, persistenceFailure), primary);
  assert.equal(preservePrimaryFailure(undefined, persistenceFailure), persistenceFailure);
});
