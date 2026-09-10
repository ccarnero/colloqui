import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ChannelAccount } from "@yoizen/shared";

export type EvaluationRow = Readonly<Record<string, unknown>>;
export type JourneyVerdict = "pending" | "passed" | "failed";
export type EvaluationJourney = "J1" | "J2" | "J3" | "J4" | "J5";
export type SnapshotEntry = Readonly<{ id: string; hash: string }>;

export type InboundAccountFailureCode =
  | "malformed_account"
  | "account_id_mismatch"
  | "account_name_mismatch"
  | "account_tenant_mismatch"
  | "account_channel_mismatch"
  | "account_inactive"
  | "account_external_id_missing"
  | "account_external_id_invalid"
  | "account_secret_missing";

export type InboundAccountFacts = Readonly<
  Pick<ChannelAccount, "id" | "name" | "tenantId" | "channel" | "externalId" | "isActive"> & {
    readonly hasSecret: boolean;
  }
>;

export type InboundAccountResolution =
  | Readonly<{ ok: true; accountId: string; externalId: string; encodedInstance: string }>
  | Readonly<{ ok: false; code: InboundAccountFailureCode }>;

export type J3Operation =
  | "account_validation"
  | "ingress_publication"
  | "execution_list_observation"
  | "execution_completion_observation"
  | "detail_validation"
  | "correlation_capture"
  | "tracking_run_observation"
  | "sent_event_observation";

export type J3Checkpoint =
  | "none"
  | "account_validated"
  | "ingress_published"
  | "execution_list_observed"
  | "execution_completed"
  | "detail_validated"
  | "correlation_captured"
  | "tracking_run_observed"
  | "sent_event_observed";

export type DiagnosticFailureCode =
  | "transport_error"
  | "http_error"
  | "malformed_response"
  | "ownership_mismatch"
  | "timeout"
  | "assertion_failed"
  | "diagnostic_write_failed"
  | "safety_disable_failed"
  | "preservation_failed"
  | "ledger_write_failed";

export interface SafeDiagnosticFailure {
  readonly code: DiagnosticFailureCode;
  readonly status?: number;
}

export type ExecutionStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT" | "unknown";

export interface OwnedExecutionObservations {
  readonly count: number;
  readonly executionIds: readonly string[];
  readonly completedExecutionIds: readonly string[];
  readonly statusCounts: Readonly<Partial<Record<ExecutionStatus, number>>>;
}

export interface J3DiagnosticState {
  readonly journey: "J3";
  readonly attemptedOperation: J3Operation | "none";
  readonly lastCompletedCheckpoint: J3Checkpoint;
  readonly observations: OwnedExecutionObservations;
  readonly failure?: SafeDiagnosticFailure;
}

export type DiagnosticWriteOutcome =
  | Readonly<{ ok: true; path: string }>
  | Readonly<{ ok: false; code: "unsafe_destination" | "checkpoint_exists" | "write_failed" }>;

export type TransportOutcome<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>;
export type SafeTransportResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: SafeDiagnosticFailure }>;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const isNanoId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{21}$/.test(value);

const isRow = (value: unknown): value is EvaluationRow =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

export function resolveInboundAccount(
  capturedId: string | undefined,
  account: unknown,
  expectedName: string,
  tenant: string
): InboundAccountResolution {
  if (!isUuid(capturedId) || !isRow(account)) return { ok: false, code: "malformed_account" };
  if (account.id !== capturedId) return { ok: false, code: "account_id_mismatch" };
  if (account.name !== expectedName) return { ok: false, code: "account_name_mismatch" };
  if (account.tenantId !== tenant && account.tenant_id !== tenant) return { ok: false, code: "account_tenant_mismatch" };
  if (account.channel !== "http") return { ok: false, code: "account_channel_mismatch" };
  if (account.isActive !== true) return { ok: false, code: "account_inactive" };
  if (typeof account.externalId !== "string" || account.externalId.trim().length === 0) {
    return { ok: false, code: "account_external_id_missing" };
  }
  if (account.externalId === "." || account.externalId === ".." || hasUnpairedSurrogate(account.externalId)) {
    return { ok: false, code: "account_external_id_invalid" };
  }
  if (account.hasSecret !== true) return { ok: false, code: "account_secret_missing" };
  return {
    ok: true,
    accountId: capturedId,
    externalId: account.externalId,
    encodedInstance: encodeURIComponent(account.externalId),
  };
}

const EMPTY_OBSERVATIONS: OwnedExecutionObservations = {
  count: 0,
  executionIds: [],
  completedExecutionIds: [],
  statusCounts: {},
};

export const initialJ3Diagnostic = (): J3DiagnosticState => ({
  journey: "J3",
  attemptedOperation: "none",
  lastCompletedCheckpoint: "none",
  observations: EMPTY_OBSERVATIONS,
});

export const attemptJ3Operation = (state: J3DiagnosticState, operation: J3Operation): J3DiagnosticState => ({
  ...state,
  attemptedOperation: operation,
  failure: undefined,
});

export const completeJ3Operation = (
  state: J3DiagnosticState,
  checkpoint: J3Checkpoint,
  observations: OwnedExecutionObservations = state.observations
): J3DiagnosticState => ({ ...state, lastCompletedCheckpoint: checkpoint, observations, failure: undefined });

export const updateJ3Observations = (
  state: J3DiagnosticState,
  observations: OwnedExecutionObservations
): J3DiagnosticState => ({ ...state, observations });

export const failJ3Operation = (state: J3DiagnosticState, failure: SafeDiagnosticFailure): J3DiagnosticState => ({
  ...state,
  failure,
});

const DIAGNOSTIC_FAILURE_CODES: readonly DiagnosticFailureCode[] = [
  "transport_error", "http_error", "malformed_response", "ownership_mismatch", "timeout", "assertion_failed",
  "diagnostic_write_failed", "safety_disable_failed", "preservation_failed", "ledger_write_failed",
];

export const safeDiagnosticFailure = (code: DiagnosticFailureCode, status?: number): SafeDiagnosticFailure => ({
  code: DIAGNOSTIC_FAILURE_CODES.includes(code) ? code : "assertion_failed",
  ...(Number.isInteger(status) && status! >= 100 && status! <= 599 ? { status } : {}),
});

const executionStatus = (value: unknown): ExecutionStatus => {
  switch (value) {
    case "PENDING":
    case "RUNNING":
    case "COMPLETED":
    case "FAILED":
    case "CANCELLED":
    case "TIMED_OUT":
      return value;
    default:
      return "unknown";
  }
};

export function observeOwnedExecutions(rows: readonly EvaluationRow[], ownershipMarker: string): OwnedExecutionObservations {
  const owned = rows.filter((row) => canonical(row).includes(ownershipMarker) && isNanoId(row.id));
  const statusCounts: Partial<Record<ExecutionStatus, number>> = {};
  for (const row of owned) {
    const status = executionStatus(row.status);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  const executionIds = owned.map((row) => row.id as string).sort();
  const completedExecutionIds = owned.filter((row) => row.status === "COMPLETED").map((row) => row.id as string).sort();
  return { count: owned.length, executionIds, completedExecutionIds, statusCounts };
}

export const preservePrimaryFailure = <T>(primary: T | undefined, secondary: T): T => primary ?? secondary;

export const normalizeTransportOutcome = <T>(outcome: TransportOutcome<T>): SafeTransportResult<T> =>
  outcome.ok ? outcome : { ok: false, failure: safeDiagnosticFailure("transport_error") };

export const diagnosticFailureForWriteOutcome = (
  outcome: DiagnosticWriteOutcome
): SafeDiagnosticFailure | undefined => outcome.ok ? undefined : safeDiagnosticFailure("diagnostic_write_failed");

const J3_OPERATIONS: readonly (J3Operation | "none")[] = [
  "none", "account_validation", "ingress_publication", "execution_list_observation", "execution_completion_observation",
  "detail_validation", "correlation_capture", "tracking_run_observation", "sent_event_observation",
];
const J3_CHECKPOINTS: readonly J3Checkpoint[] = [
  "none", "account_validated", "ingress_published", "execution_list_observed", "execution_completed",
  "detail_validated", "correlation_captured", "tracking_run_observed", "sent_event_observed",
];

const j3DiagnosticEvidence = (state: J3DiagnosticState): J3DiagnosticState => ({
  journey: "J3",
  attemptedOperation: J3_OPERATIONS.includes(state.attemptedOperation) ? state.attemptedOperation : "none",
  lastCompletedCheckpoint: J3_CHECKPOINTS.includes(state.lastCompletedCheckpoint) ? state.lastCompletedCheckpoint : "none",
  observations: {
    count: Number.isSafeInteger(state.observations.count) && state.observations.count >= 0 ? state.observations.count : 0,
    executionIds: state.observations.executionIds.filter(isNanoId),
    completedExecutionIds: state.observations.completedExecutionIds.filter(isNanoId),
    statusCounts: Object.fromEntries(Object.entries(state.observations.statusCounts).filter(([status, count]) =>
      ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "unknown"].includes(status)
      && Number.isInteger(count) && Number(count) >= 0
    )),
  },
  ...(state.failure ? { failure: safeDiagnosticFailure(state.failure.code, state.failure.status) } : {}),
});

/** Imperative boundary: writes one immutable, allowlisted diagnostic checkpoint. */
export async function writeJ3DiagnosticCheckpoint(
  trustedRoot: string,
  evidenceRoot: string,
  runId: string,
  sequence: number,
  state: J3DiagnosticState
): Promise<DiagnosticWriteOutcome> {
  if (!isUuid(runId) || !Number.isSafeInteger(sequence) || sequence < 0 || sequence > 999) {
    return { ok: false, code: "unsafe_destination" };
  }
  const resolvedTrustedRoot = resolve(trustedRoot);
  const resolvedRoot = isAbsolute(evidenceRoot) ? resolve(evidenceRoot) : resolve(resolvedTrustedRoot, evidenceRoot);
  const lexicalRelative = relative(resolvedTrustedRoot, resolvedRoot);
  if (lexicalRelative === ".." || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) {
    return { ok: false, code: "unsafe_destination" };
  }
  const runDirectory = resolve(resolvedRoot, runId);
  if (dirname(runDirectory) !== resolvedRoot) return { ok: false, code: "unsafe_destination" };
  try {
    const trustedPhysicalRoot = await realpath(resolvedTrustedRoot);
    let current = resolvedTrustedRoot;
    for (const part of lexicalRelative.split(sep).filter(Boolean)) {
      current = resolve(current, part);
      const ancestor = await lstat(current);
      if (!ancestor.isDirectory() || ancestor.isSymbolicLink()) return { ok: false, code: "unsafe_destination" };
    }
    const physicalRoot = await realpath(resolvedRoot);
    const physicalRelative = relative(trustedPhysicalRoot, physicalRoot);
    if (physicalRelative === ".." || physicalRelative.startsWith(`..${sep}`) || isAbsolute(physicalRelative)) {
      return { ok: false, code: "unsafe_destination" };
    }
    try {
      await mkdir(runDirectory, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (!isRow(error) || error.code !== "EEXIST") return { ok: false, code: "write_failed" };
    }
    const directoryInfo = await lstat(runDirectory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return { ok: false, code: "unsafe_destination" };
    const checkpointPath = resolve(runDirectory, `j3-checkpoint-${String(sequence).padStart(3, "0")}.json`);
    if (dirname(checkpointPath) !== runDirectory) return { ok: false, code: "unsafe_destination" };
    try {
      const candidate = await lstat(checkpointPath);
      if (candidate.isSymbolicLink()) return { ok: false, code: "unsafe_destination" };
      if (candidate.isFile()) return { ok: false, code: "checkpoint_exists" };
    } catch (error) {
      if (!isRow(error) || error.code !== "ENOENT") return { ok: false, code: "write_failed" };
    }
    let file: Awaited<ReturnType<typeof open>>;
    try {
      file = await open(checkpointPath, "wx", 0o600);
    } catch {
      return { ok: false, code: "write_failed" };
    }
    try {
      await file.writeFile(`${JSON.stringify(j3DiagnosticEvidence(state), null, 2)}\n`, "utf8");
    } finally {
      await file.close();
    }
    return { ok: true, path: checkpointPath };
  } catch (error) {
    return { ok: false, code: isRow(error) && error.code === "EEXIST" ? "checkpoint_exists" : "write_failed" };
  }
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!isRow(value)) return JSON.stringify(value) ?? "null";
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};

const semanticHash = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

const project = (kind: "channel" | "workflow", row: EvaluationRow): EvaluationRow => {
  const keys = kind === "channel"
    ? ["id", "name", "channel", "provider", "externalId", "isActive", "createdAt"]
    : ["id", "name", "application", "actions", "trigger", "variables", "status", "createdAt"];
  return Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
};

export function snapshotResources(kind: "channel" | "workflow", rows: readonly EvaluationRow[]): readonly SnapshotEntry[] {
  const validId = kind === "channel" ? isUuid : isNanoId;
  return rows.flatMap((row) => validId(row.id) ? [{ id: row.id, hash: semanticHash(project(kind, row)) }] : [])
    .sort((left, right) => left.id.localeCompare(right.id));
}

export const withoutOwned = (rows: readonly SnapshotEntry[], owned: readonly string[]): readonly SnapshotEntry[] =>
  rows.filter(({ id }) => !owned.includes(id));

export const sameSnapshot = (before: readonly SnapshotEntry[], after: readonly SnapshotEntry[]): boolean =>
  canonical(before) === canonical(after);

export function workflowMutationAuthority(
  capturedId: string | undefined,
  resource: unknown,
  expectedName: string,
  tenant: string
): Readonly<{ ok: true; id: string }> | Readonly<{ ok: false }> {
  if (!isNanoId(capturedId) || !isRow(resource)) return { ok: false };
  return resource.id === capturedId && resource.name === expectedName && resource.tenantId === tenant
    ? { ok: true, id: capturedId }
    : { ok: false };
}

export const safetyFailureStage = <T extends string>(primaryStage: T | undefined): T | "safety" =>
  primaryStage ?? "safety";

export interface ExpectedApplyResource {
  readonly kind: "channel" | "workflow";
  readonly name: string;
}

export interface CapturedApplyResource extends ExpectedApplyResource {
  readonly id: string;
}

export interface ApplyInspection {
  readonly captured: readonly CapturedApplyResource[];
  readonly issues: readonly string[];
}

export function inspectApplyResponse(status: number, body: unknown, expected: readonly ExpectedApplyResource[]): ApplyInspection {
  const container = status === 200 ? body : status === 409 && isRow(body) ? body.error : undefined;
  const rows = isRow(container)
    ? (status === 200 ? container.resources : isRow(container) ? container.applied : undefined)
    : undefined;
  if (!Array.isArray(rows)) return { captured: [], issues: ["apply response lacks a typed resource list"] };

  const expectedByKey = new Map(expected.map((item) => [`${item.kind}:${item.name}`, item]));
  const occurrences = new Map<string, EvaluationRow[]>();
  const issues: string[] = [];
  for (const value of rows) {
    if (!isRow(value) || typeof value.kind !== "string" || typeof value.name !== "string") {
      issues.push("apply resource is malformed");
      continue;
    }
    const key = `${value.kind}:${value.name}`;
    if (!expectedByKey.has(key)) {
      issues.push(expected.some((item) => item.name === value.name) ? `wrong kind for ${value.name}` : `unknown apply resource ${key}`);
      continue;
    }
    occurrences.set(key, [...(occurrences.get(key) ?? []), value]);
  }

  const captured: CapturedApplyResource[] = [];
  for (const item of expected) {
    const key = `${item.kind}:${item.name}`;
    const matches = occurrences.get(key) ?? [];
    if (matches.length > 1) {
      issues.push(`duplicate apply resource ${key}`);
      continue;
    }
    const match = matches[0];
    if (!match) continue;
    const id = match.externalId;
    const valid = item.kind === "channel" ? isUuid(id) : isNanoId(id);
    if (!valid) {
      issues.push(`invalid ${item.kind} ID for ${item.name}`);
      continue;
    }
    captured.push({ ...item, id: id as string });
  }
  return { captured: captured.sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`)), issues: issues.sort() };
}

export function preservationState(
  verdicts: Readonly<Record<EvaluationJourney, JourneyVerdict>>,
  primaryStage: EvaluationJourney | "safety" | undefined,
  passed: boolean
): Readonly<{ verdicts: Readonly<Record<EvaluationJourney, JourneyVerdict>>; failedStage: EvaluationJourney | "preservation" | "safety" | undefined; preservation: "passed" | "failed" }> {
  return { verdicts: { ...verdicts }, failedStage: primaryStage ?? (passed ? undefined : "preservation"), preservation: passed ? "passed" : "failed" };
}
