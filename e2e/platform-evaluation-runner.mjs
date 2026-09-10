import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { spawn } from "node:child_process";
import path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_ORIGIN = "http://api-gateway.platform-services-dev.dev.local";
const CONSOLE_ORIGIN = "http://admin-console.platform-services-dev.dev.local";
const TENANT = "acme";
const REQUEST_TIMEOUT_MS = 10_000;
const CHILD_TIMEOUT_MS = 15 * 60_000;
const TOTAL_TIMEOUT_MS = 20 * 60_000;
const PRIVATE_ROOT = "/private/tmp";
const EVIDENCE_ROOT = path.resolve("manual-loops/architecture/end-to-end-evaluation/evidence/t02");
let interruptedBy = null;
let activeChild = null;

function terminationPlan(groupPid) {
  return Number.isInteger(groupPid) && groupPid > 0
    ? [{ groupPid, signal: "SIGTERM", delayMs: 0 }, { groupPid, signal: "SIGKILL", delayMs: 3_000 }]
    : [];
}

function terminateOwnedGroup(groupPid) {
  const [term, kill] = terminationPlan(groupPid);
  if (!term || !kill) return;
  try { process.kill(-term.groupPid, term.signal); } catch {}
  setTimeout(() => {
    try { process.kill(-kill.groupPid, kill.signal); } catch {}
  }, kill.delayMs).unref();
}

function terminateOwnedChild() {
  terminateOwnedGroup(activeChild?.pid);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interruptedBy ??= signal;
    terminateOwnedChild();
  });
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const asObjects = (value) => Array.isArray(value) ? value.filter(isObject) : [];
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : isObject(value)
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value) ?? "null";
const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const getString = (value, key) => isObject(value) && typeof value[key] === "string" ? value[key] : undefined;

function validateUuid(value, label) {
  return UUID_RE.test(value) ? { ok: true, value } : { ok: false, error: `${label} must be a UUID` };
}

function identityPathOutcome(candidate) {
  const resolved = path.resolve(candidate);
  const match = /^platform-evaluation-identity-([0-9a-f-]+)\.json$/i.exec(path.basename(resolved));
  if (path.dirname(resolved) !== PRIVATE_ROOT || !match) return { ok: false, error: "identity path must use the fixed private directory and basename" };
  const uuid = validateUuid(match[1], "identity filename");
  return uuid.ok ? { ok: true, value: { path: resolved, identityId: uuid.value } } : uuid;
}

function selectIdentityMode(identityFile, generatedId) {
  if (identityFile) {
    const checked = identityPathOutcome(identityFile);
    return checked.ok ? { ok: true, value: { mode: "reuse", ...checked.value } } : checked;
  }
  const checked = validateUuid(generatedId, "generated identity");
  return checked.ok ? { ok: true, value: { mode: "new", identityId: checked.value, path: `${PRIVATE_ROOT}/platform-evaluation-identity-${checked.value}.json` } } : checked;
}

function selectAdminCredentials(parsed) {
  const email = typeof parsed.E2E_EMAIL === "string" ? parsed.E2E_EMAIL.trim() : "";
  const password = typeof parsed.E2E_PASSWORD === "string" ? parsed.E2E_PASSWORD : "";
  return email && password ? { ok: true, value: { email, password } } : { ok: false, error: "scripts/e2e/.env lacks E2E_EMAIL or E2E_PASSWORD" };
}

function claimsOutcome(claims, expected) {
  if (!isObject(claims)) return { ok: false, error: "claims are not an object" };
  const permissions = claims.permissions;
  const matches = claims.scope === "tenant:acme" && claims.sub === expected.userId &&
    claims.role === expected.roleName && claims.tenant_id === TENANT &&
    Array.isArray(permissions) && permissions.every((permission) => typeof permission === "string") && permissions.length === 0;
  return matches ? { ok: true, value: true } : { ok: false, error: "restricted claims do not match the captured identity" };
}

function countsOutcome(counts) {
  const limits = { roleCreate: 1, userCreate: 1, reactivate: 1, childRun: 1, deactivate: 1 };
  for (const [key, limit] of Object.entries(limits)) if (!Number.isInteger(counts[key]) || counts[key] < 0 || counts[key] > limit) return { ok: false, error: `${key} exceeds its write bound` };
  return { ok: true, value: true };
}

function ownedRoleOutcome(role, identity) {
  const matches = isObject(role) && role.id === identity.roleId && role.name === identity.roleName &&
    role.description === identity.marker && role.tenant_id === TENANT && role.is_system === false &&
    Array.isArray(role.permissions) && role.permissions.length === 0;
  return matches ? { ok: true, value: true } : { ok: false, error: "owned role retention was not observed" };
}

function preservationOutcome({ snapshotsMatch, deactivationVerified, ownedRoleVerified }) {
  return snapshotsMatch && deactivationVerified && ownedRoleVerified
    ? { ok: true, value: { exactMatch: true, ownedUserInactive: true, ownedRoleRetained: true } }
    : { ok: false, error: "identity preservation was not fully observed" };
}

function cleanupDecision({ hasOwnedUser, evidenceCheckpointOk }) {
  return { attemptDeactivation: hasOwnedUser, evidenceFailure: evidenceCheckpointOk ? undefined : "pre-deactivation checkpoint failed" };
}

const preservePrimaryFailure = (primary, cleanupFailure) => primary ?? cleanupFailure;

function safeProjection(kind, row, permissions = []) {
  const keys = kind === "role"
    ? ["id", "tenant_id", "name", "description", "is_system", "created_at"]
    : ["id", "tenant_id", "email", "role_id", "role", "display_name", "created_at"];
  const projected = Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
  const sortedPermissions = [...permissions].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return kind === "role" ? { ...projected, permissions: sortedPermissions } : projected;
}

function sanitize(value, secrets) {
  const scrub = (text) => secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join("[REDACTED]"), String(text));
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets));
  if (!isObject(value)) return typeof value === "string" ? scrub(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /password|token|authorization|cookie|secret/i.test(key) ? "[REDACTED]" : sanitize(child, secrets)]));
}

function decodeJwt(token) {
  try {
    const parsed = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return isObject(parsed) ? parsed : {};
  } catch { return {}; }
}

async function apiRequest(method, pathname, { token, data, expected }) {
  const url = new URL(pathname, API_ORIGIN);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/api/")) throw new Error("request target escaped the approved gateway");
  let response;
  try {
    response = await fetch(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-yoizen-tenant": TENANT, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  } catch { throw new Error(`${method} ${url.pathname} failed before a response`); }
  if (response.status >= 300 && response.status < 400) throw new Error(`${method} ${url.pathname} returned a redirect`);
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.includes(response.status)) throw new Error(`${method} ${url.pathname} returned HTTP ${response.status}`);
  let body = {};
  if (response.headers.get("content-type")?.includes("json")) {
    try { body = await response.json(); } catch { throw new Error(`${method} ${url.pathname} returned invalid JSON`); }
  }
  return { status: response.status, body };
}

async function login(email, password) {
  return apiRequest("POST", "/api/auth/login", { data: { email, password, tenant_id: TENANT }, expected: 201 });
}

async function snapshot(token) {
  const [usersResponse, rolesResponse] = await Promise.all([
    apiRequest("GET", "/api/auth/tenant-users", { token, expected: 200 }),
    apiRequest("GET", "/api/auth/tenant-roles", { token, expected: 200 }),
  ]);
  const users = asObjects(usersResponse.body);
  const roles = asObjects(rolesResponse.body);
  const roleDetails = [];
  for (const role of roles) {
    const id = getString(role, "id");
    if (!id) throw new Error("role list returned a malformed identity");
    const detail = (await apiRequest("GET", `/api/auth/tenant-roles/${encodeURIComponent(id)}`, { token, expected: 200 })).body;
    if (!isObject(detail)) throw new Error("role detail returned a malformed identity");
    roleDetails.push(detail);
  }
  return {
    users: users.map((row) => ({ id: getString(row, "id"), hash: hash(safeProjection("user", row)) })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    roles: roleDetails.map((row) => ({ id: getString(row, "id"), hash: hash(safeProjection("role", row, Array.isArray(row.permissions) ? row.permissions : [])) })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    rawUsers: users,
    rawRoles: roleDetails,
  };
}

async function loadAdminCredentials() {
  const parsed = parseEnv(await readFile("scripts/e2e/.env", "utf8"));
  const selected = selectAdminCredentials(parsed);
  if (!selected.ok) throw new Error(selected.error);
  return selected.value;
}

async function assertPrivateIdentityFile(file) {
  const outcome = identityPathOutcome(file);
  if (!outcome.ok) throw new Error(outcome.error);
  const handle = await open(outcome.value.path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let parsed;
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid()) throw new Error("identity file must be owned by this user, regular, and mode 0600");
    parsed = JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
  const expectedName = `eval-e2e-${outcome.value.identityId}`;
  const expectedEmail = `${expectedName}@example.invalid`;
  const expectedMarker = `Owned platform evaluation identity ${outcome.value.identityId}`;
  if (!isObject(parsed) || parsed.identityId !== outcome.value.identityId || !UUID_RE.test(parsed.userId) || !UUID_RE.test(parsed.roleId) || typeof parsed.password !== "string" || parsed.password.length < 8 || parsed.roleName !== expectedName || parsed.email !== expectedEmail || parsed.marker !== expectedMarker || parsed.totalRoleCreates !== 1 || parsed.totalUserCreates !== 1) throw new Error("identity file content is malformed or not bound to its filename identity");
  return parsed;
}

async function persistPrivate(file, value, exclusive = false) {
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW | (exclusive ? fsConstants.O_EXCL : 0);
  const handle = await open(file, flags, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) throw new Error("private output descriptor is unsafe");
    await handle.truncate(0); await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  finally { await handle.close(); }
}

async function runChild(env, secrets) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "e2e/platform-evaluation.config.ts", "--workers=1", "--retries=0"], {
      shell: false,
      detached: true,
      env: { PATH: process.env.PATH ?? "", PLAYWRIGHT_NO_COPY_PROMPT: "1", E2E_TENANT: TENANT, E2E_API_URL: API_ORIGIN, E2E_BASE_URL: CONSOLE_ORIGIN, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateOwnedGroup(child.pid);
    }, CHILD_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => { clearTimeout(timer); activeChild = null; resolve({ exitCode: null, signal: null, timedOut, stdout: "", stderr: "child process failed to start" }); });
    child.on("close", (exitCode, signal) => { clearTimeout(timer); activeChild = null; resolve(sanitize({ exitCode, signal, timedOut, stdout, stderr }, secrets)); });
  });
}

async function selfTest() {
  const secret = "known-secret-value";
  const cases = [
    [validateUuid(randomUUID(), "id").ok, true], [validateUuid("../bad", "id").ok, false],
    [identityPathOutcome(`/private/tmp/platform-evaluation-identity-${randomUUID()}.json`).ok, true],
    [identityPathOutcome(`/tmp/platform-evaluation-identity-${randomUUID()}.json`).ok, false],
    [selectIdentityMode(undefined, randomUUID()).value?.mode, "new"],
    [selectIdentityMode(`/private/tmp/platform-evaluation-identity-${randomUUID()}.json`, randomUUID()).value?.mode, "reuse"],
    [selectAdminCredentials({ E2E_EMAIL: " admin@example.invalid ", E2E_PASSWORD: "password", IGNORED: secret }).value?.email, "admin@example.invalid"],
    [selectAdminCredentials({ E2E_EMAIL: "", E2E_PASSWORD: "password" }).ok, false],
    [claimsOutcome({ scope: "tenant:acme", tenant_id: "acme", sub: "u", role: "r", permissions: [] }, { userId: "u", roleName: "r" }).ok, true],
    [claimsOutcome({ scope: "tenant:acme", tenant_id: "acme", sub: "u", role: "r", permissions: ["*"] }, { userId: "u", roleName: "r" }).ok, false],
    [claimsOutcome({ scope: "tenant:acme", tenant_id: "acme", sub: "u", role: "r" }, { userId: "u", roleName: "r" }).ok, false],
    [claimsOutcome({ scope: "tenant:acme", tenant_id: "acme", sub: "u", role: "r", permissions: [1] }, { userId: "u", roleName: "r" }).ok, false],
    [countsOutcome({ roleCreate: 1, userCreate: 1, reactivate: 1, childRun: 1, deactivate: 1 }).ok, true],
    [countsOutcome({ roleCreate: 2, userCreate: 0, reactivate: 0, childRun: 0, deactivate: 0 }).ok, false],
    [canonical(terminationPlan(42)), canonical([{ groupPid: 42, signal: "SIGTERM", delayMs: 0 }, { groupPid: 42, signal: "SIGKILL", delayMs: 3_000 }])],
    [terminationPlan(undefined).length, 0],
    [preservationOutcome({ snapshotsMatch: true, deactivationVerified: true, ownedRoleVerified: true }).ok, true],
    [preservationOutcome({ snapshotsMatch: true, deactivationVerified: false, ownedRoleVerified: true }).ok, false],
    [preservationOutcome({ snapshotsMatch: true, deactivationVerified: true, ownedRoleVerified: false }).ok, false],
    [cleanupDecision({ hasOwnedUser: true, evidenceCheckpointOk: false }).attemptDeactivation, true],
    [cleanupDecision({ hasOwnedUser: false, evidenceCheckpointOk: false }).attemptDeactivation, false],
  ];
  for (const [actual, expected] of cases) assert.equal(actual, expected);
  const cleaned = sanitize({ password: secret, nested: { token: secret, cookieHeaders: secret, safe: `x-${secret}` } }, [secret]);
  assert(!canonical(cleaned).includes(secret));
  const identity = { roleId: "role", roleName: "name", marker: "marker" };
  assert.equal(ownedRoleOutcome({ id: "role", name: "name", description: "marker", tenant_id: TENANT, is_system: false, permissions: [] }, identity).ok, true);
  assert.equal(ownedRoleOutcome({ id: "role", name: "name", description: "marker", tenant_id: TENANT, is_system: false, permissions: ["unexpected"] }, identity).ok, false);
  const primary = new Error("primary");
  assert.equal(preservePrimaryFailure(primary, new Error("cleanup")), primary);
  assert.equal(preservePrimaryFailure(undefined, new Error("cleanup")).message, "cleanup");
  console.log(`platform-evaluation-runner self-test passed: ${cases.length + 5} cases`);
}

async function main() {
  const { values } = parseArgs({ options: { "self-test": { type: "boolean" }, "identity-file": { type: "string" } }, strict: true });
  if (values["self-test"]) return selfTest();
  const selection = selectIdentityMode(values["identity-file"], randomUUID());
  if (!selection.ok) throw new Error(selection.error);
  const identityId = selection.value.identityId;
  const evidenceDir = path.resolve(EVIDENCE_ROOT, `identity-${identityId}`);
  if (path.dirname(evidenceDir) !== EVIDENCE_ROOT) throw new Error("evidence path escaped its root");
  if (values["identity-file"]) {
    await mkdir(evidenceDir, { recursive: true });
    const evidenceInfo = await lstat(evidenceDir);
    if (evidenceInfo.isSymbolicLink() || !evidenceInfo.isDirectory()) throw new Error("identity evidence directory is unsafe");
  } else await mkdir(evidenceDir, { recursive: false });
  const invocationId = randomUUID();
  const evidenceFile = path.join(evidenceDir, `invocation-${invocationId}.json`);
  const identityFile = selection.value.path;
  const counts = { roleCreate: 0, userCreate: 0, reactivate: 0, childRun: 0, deactivate: 0 };
  const record = { identityId, invocationId, startedAt: new Date().toISOString(), identityFile, counts, mutations: [], status: "running" };
  const checkpoint = (exclusive = false) => persistPrivate(evidenceFile, sanitize(record, []), exclusive);
  let adminToken, identity, baseline, primaryError;
  const admin = await loadAdminCredentials();
  const secrets = [admin.password];
  await checkpoint(true);
  const ensureRunning = () => { if (interruptedBy) throw new Error("runner interrupted before the next effect"); };
  const overall = setTimeout(() => {
    interruptedBy ??= "TOTAL_TIMEOUT";
    terminateOwnedChild();
  }, TOTAL_TIMEOUT_MS);
  let deactivationVerified = false;
  try {
    const adminLogin = await login(admin.email, admin.password);
    adminToken = getString(adminLogin.body, "access_token");
    const adminClaims = decodeJwt(adminToken ?? "");
    const adminPermissions = Array.isArray(adminClaims.permissions) ? adminClaims.permissions : [];
    if (adminClaims.scope !== "tenant:acme" || adminClaims.role !== "tenant_admin" || (!adminPermissions.includes("*") && !adminPermissions.includes("roles:create"))) throw new Error("administrator token lacks required tenant administration authority");
    baseline = await snapshot(adminToken);
    const systemAdmin = baseline.rawRoles.find((role) => role.name === "tenant_admin" && role.is_system === true);
    if (!systemAdmin) throw new Error("existing tenant_admin system role is required before user creation");
    if (values["identity-file"]) {
      identity = await assertPrivateIdentityFile(identityFile);
      secrets.push(identity.password);
      const role = (await apiRequest("GET", `/api/auth/tenant-roles/${identity.roleId}`, { token: adminToken, expected: 200 })).body;
      if (!isObject(role) || role.name !== identity.roleName || role.description !== identity.marker || role.tenant_id !== TENANT || role.is_system !== false || !Array.isArray(role.permissions) || role.permissions.length !== 0) throw new Error("saved role no longer matches its captured identity");
      const active = baseline.rawUsers.find((user) => user.id === identity.userId);
      ensureRunning();
      let ownedUser = active;
      if (!active) {
        counts.reactivate++;
        ownedUser = (await apiRequest("PATCH", `/api/auth/tenant-users/${identity.userId}`, { token: adminToken, data: { is_active: true }, expected: 200 })).body;
        record.mutations.push({ kind: "user-reactivate", id: identity.userId, status: "captured" });
        await checkpoint();
      }
      if (!isObject(ownedUser) || ownedUser.id !== identity.userId || ownedUser.tenant_id !== TENANT || ownedUser.email !== identity.email || ownedUser.role_id !== identity.roleId || ownedUser.display_name !== identity.marker) throw new Error("saved user no longer matches its captured identity");
    } else {
      const roleName = `eval-e2e-${identityId}`;
      const email = `${roleName}@example.invalid`;
      const marker = `Owned platform evaluation identity ${identityId}`;
      if (baseline.rawRoles.some((role) => role.name === roleName) || baseline.rawUsers.some((user) => user.email === email)) throw new Error("dedicated identity name collision");
      const password = randomBytes(32).toString("base64url");
      secrets.push(password);
      identity = { identityId, roleId: null, userId: null, roleName, email, password, marker, totalRoleCreates: 0, totalUserCreates: 0 };
      await persistPrivate(identityFile, identity, true);
      ensureRunning();
      let roleResponse;
      try { roleResponse = await apiRequest("POST", "/api/auth/tenant-roles", { token: adminToken, data: { tenant_id: TENANT, name: roleName, description: marker, permissions: [] }, expected: 201 }); }
      catch { record.unknownResidue = [{ kind: "role", name: roleName, status: "create-response-uncaptured" }]; await checkpoint(); throw new Error("role creation response was not safely captured"); }
      counts.roleCreate++; identity.totalRoleCreates++; identity.roleId = getString(roleResponse.body, "id");
      if (!UUID_RE.test(identity.roleId ?? "") || !isObject(roleResponse.body) || roleResponse.body.name !== roleName || roleResponse.body.description !== marker || roleResponse.body.tenant_id !== TENANT || roleResponse.body.is_system !== false || !Array.isArray(roleResponse.body.permissions) || roleResponse.body.permissions.length !== 0) { record.unknownResidue = [{ kind: "role", name: roleName, status: "create-response-malformed" }]; await checkpoint(); throw new Error("role create response did not capture the exact owned role"); }
      await persistPrivate(identityFile, identity); record.mutations.push({ kind: "role-create", id: identity.roleId, status: "captured" });
      await checkpoint();
      const role = (await apiRequest("GET", `/api/auth/tenant-roles/${identity.roleId}`, { token: adminToken, expected: 200 })).body;
      if (!isObject(role) || role.name !== roleName || role.description !== marker || role.tenant_id !== TENANT || role.is_system !== false || !Array.isArray(role.permissions) || role.permissions.length !== 0) throw new Error("created role failed exact verification");
      let userResponse;
      ensureRunning();
      try { userResponse = await apiRequest("POST", "/api/auth/tenant-users", { token: adminToken, data: { tenant_id: TENANT, email, password, role_id: identity.roleId, display_name: marker }, expected: 201 }); }
      catch { record.unknownResidue = [...(record.unknownResidue ?? []), { kind: "user", name: email, status: "create-response-uncaptured" }]; await checkpoint(); throw new Error("user creation response was not safely captured"); }
      counts.userCreate++; identity.totalUserCreates++; identity.userId = getString(userResponse.body, "id");
      if (!UUID_RE.test(identity.userId ?? "")) { record.unknownResidue = [...(record.unknownResidue ?? []), { kind: "user", name: email, status: "create-response-malformed" }]; await checkpoint(); throw new Error("user create response did not capture an exact UUID"); }
      await persistPrivate(identityFile, identity); record.mutations.push({ kind: "user-create", id: identity.userId, status: "captured" });
      await checkpoint();
      const user = userResponse.body;
      if (!isObject(user) || user.id !== identity.userId || user.tenant_id !== TENANT || user.email !== email || user.role_id !== identity.roleId || user.display_name !== marker) throw new Error("created user failed exact verification");
    }
    if (!countsOutcome(counts).ok || identity.totalRoleCreates !== 1 || identity.totalUserCreates !== 1) throw new Error("identity creation count invariant failed");
    const restrictedLogin = await login(identity.email, identity.password);
    const restrictedToken = getString(restrictedLogin.body, "access_token");
    secrets.push(restrictedToken ?? "", adminToken);
    const claimCheck = claimsOutcome(decodeJwt(restrictedToken ?? ""), { userId: identity.userId, roleName: identity.roleName });
    if (!claimCheck.ok) throw new Error(claimCheck.error);
    await apiRequest("GET", "/api/workflows", { token: restrictedToken, expected: 200 });
    const runId = randomUUID();
    ensureRunning();
    counts.childRun++;
    await checkpoint();
    const child = await runChild({ E2E_EMAIL: admin.email, E2E_PASSWORD: admin.password, E2E_RESTRICTED_TOKEN: restrictedToken, E2E_EVAL_RUN_ID: runId }, secrets);
    record.child = child;
    await checkpoint();
    if (interruptedBy) throw new Error("runner interrupted while child was active");
    if (child.exitCode !== 0 || child.signal !== null || child.timedOut) throw new Error("Playwright child did not complete successfully");
    record.status = "journeys-passed";
  } catch (error) {
    primaryError = error;
    record.status = "failed";
    record.primaryFailure = "identity setup or child execution failed";
  } finally {
    if (identity?.userId && adminToken) {
      counts.deactivate++;
      let preCheckpointOk = true;
      try { await checkpoint(); } catch { preCheckpointOk = false; }
      const cleanup = cleanupDecision({ hasOwnedUser: true, evidenceCheckpointOk: preCheckpointOk });
      if (cleanup.evidenceFailure) { record.evidenceFailure = cleanup.evidenceFailure; primaryError = preservePrimaryFailure(primaryError, new Error("evidence checkpoint failed before deactivation")); }
      if (cleanup.attemptDeactivation) try {
        const response = await apiRequest("PATCH", `/api/auth/tenant-users/${identity.userId}`, { token: adminToken, data: { is_active: false }, expected: [200, 404] });
        const get = await apiRequest("GET", `/api/auth/tenant-users/${identity.userId}`, { token: adminToken, expected: 404 });
        void get;
        const users = asObjects((await apiRequest("GET", "/api/auth/tenant-users", { token: adminToken, expected: 200 })).body);
        const denied = await apiRequest("POST", "/api/auth/login", { data: { email: identity.email, password: identity.password, tenant_id: TENANT }, expected: 401 });
        void denied;
        if (users.some((user) => user.id === identity.userId)) throw new Error("deactivated user remains in active list");
        deactivationVerified = true;
        record.deactivation = { requestStatus: response.status, getStatus: 404, activeListAbsent: true, freshLoginStatus: 401, issuedJwtRevocationClaimed: false };
        try { await checkpoint(); }
        catch { record.evidenceFailure = "post-deactivation checkpoint failed"; primaryError = preservePrimaryFailure(primaryError, new Error("evidence checkpoint failed after deactivation")); }
      } catch { record.deactivation = { status: "failed", reason: "deactivation verification failed" }; primaryError = preservePrimaryFailure(primaryError, new Error("deactivation verification failed")); }
    }
    if (baseline && adminToken && identity) {
      try {
        const after = await snapshot(adminToken);
        const users = after.users.filter((row) => row.id !== identity.userId);
        const roles = after.roles.filter((row) => row.id !== identity.roleId);
        const baselineUsers = baseline.users.filter((row) => row.id !== identity.userId);
        const baselineRoles = baseline.roles.filter((row) => row.id !== identity.roleId);
        const snapshotsMatch = canonical(users) === canonical(baselineUsers) && canonical(roles) === canonical(baselineRoles);
        const ownedRoleVerified = ownedRoleOutcome(after.rawRoles.find((role) => role.id === identity.roleId), identity).ok;
        const outcome = preservationOutcome({ snapshotsMatch, deactivationVerified, ownedRoleVerified });
        if (!outcome.ok) throw new Error(outcome.error);
        record.preservation = { preexistingUsers: baselineUsers, preexistingRoles: baselineRoles, ...outcome.value };
      } catch { record.preservation = { exactMatch: false, reason: "identity preservation check failed" }; primaryError = preservePrimaryFailure(primaryError, new Error("identity preservation check failed")); }
    }
    record.finishedAt = new Date().toISOString();
    record.counts = counts;
    if (!countsOutcome(counts).ok) primaryError = preservePrimaryFailure(primaryError, new Error("cleanup count invariant failed"));
    record.interruptedBy = interruptedBy;
    clearTimeout(overall);
    try { await checkpoint(); }
    catch { primaryError = preservePrimaryFailure(primaryError, new Error("final evidence checkpoint failed")); }
  }
  if (primaryError) throw primaryError;
  console.log(`platform evaluation completed; sanitized evidence: ${evidenceFile}; retained identity: ${identityFile}`);
}

main().catch(() => {
  console.error("platform evaluation runner failed; inspect sanitized evidence when available");
  process.exitCode = 1;
});
