/**
 * http-connectors sample provisioning — SDK-powered replacement for the old
 * curl+jq `setup.sh` body.
 *
 * Provisions a set of EXTERNAL HTTP connectors (platform "adapters") from the
 * declarative JSON files in ../connectors, through `@yoizen/platform-sdk`'s
 * `connectors` resource. Each connector wraps a well-known public dev API so
 * a workflow can call it with an `endpointCall` action (adapterId +
 * endpointId | adapterId + url path).
 *
 * The script is a true IDEMPOTENT UPSERT (safe to re-run):
 *   1. Ensure the connector exists (create by name, or reuse the existing
 *      one).
 *   2. Reconcile its declarative config (currently just `defaultCache`, when
 *      the config file declares one).
 *   3. Reconcile its endpoints — add any (method, path) declared in the
 *      config that isn't registered yet, leaving already-present ones
 *      untouched.
 * So enriching a config with new endpoints/cache settings and re-running
 * only applies the drift. Duplicate creates / endpoints race to a
 * `ConflictError` ("already exists"), which is also treated as success
 * rather than an error.
 *
 * RECREATE=1: deletes all context=external connectors first, then
 * re-provisions from the config files. Useful when connector state has
 * drifted.
 *
 * Same env vars, defaults, and idempotency/dedup/RECREATE semantics as the
 * bash version this replaces. Invoked by `setup.sh` after
 * `../lib/resolve-env.sh` has resolved the environment. Login itself is
 * handled transparently by createClient()/the SDK session on first request —
 * no explicit login stage needed here (see http-bridge/src/setup.ts, same
 * convention: stage numbering skips the login step).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, createClient } from "@yoizen/platform-sdk";
import type {
  Connector,
  CreateConnectorEndpointInput,
  CreateConnectorInput,
} from "@yoizen/platform-sdk/connectors";

// ----- Pretty logging (verbose; nothing fails silently) ---------------------
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";
const log = (msg: string) => console.log(`${GREEN}[INFO]${NC}  ${msg}`);
const step = (msg: string) => console.log(`${BLUE}[STEP]${NC}  ${msg}`);
const warn = (msg: string) => console.log(`${YELLOW}[WARN]${NC}  ${msg}`);
const err = (msg: string) => console.error(`${RED}[ERR]${NC}   ${msg}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function fail(message: string): never {
  err(message);
  process.exit(1);
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ----- Configuration (override via env) -------------------------------------
// YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL,
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh). Only
// script-specific vars are read here.

// Connector context. These are third-party APIs => "external".
const CONTEXT = "external" as const;

// Basic-auth credentials for the httpbin-basic-auth connector. The defaults
// (user/passwd) make https://httpbin.org/basic-auth/user/passwd return 200
// { "authenticated": true } out of the box. Override both to test a mismatch.
const BASIC_USER = process.env.HTTPBIN_BASIC_USER ?? "user";
const BASIC_PASS = process.env.HTTPBIN_BASIC_PASS ?? "passwd";

const CONNECTORS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "connectors"
);

const RECREATE = process.env.RECREATE ?? "0";

const tenant = requireEnv("YOIZEN_TENANT");
const email = requireEnv("YOIZEN_EMAIL");
const password = requireEnv("YOIZEN_PASSWORD");
const baseUrl = requireEnv("YOIZEN_BASE_URL");
const hostHeader = process.env.YOIZEN_HOST_HEADER;

// The gateway's dev ingress routes by Host header (see ../lib/resolve-env.sh);
// the SDK's fetch-based transport needs it passed as a regular header since
// we're talking to a bare IP/localhost port.
const fetchWithHostHeader: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (hostHeader) {
    headers.set("Host", hostHeader);
  }
  return fetch(input, { ...init, headers });
};

const client = createClient({
  tenant,
  email,
  password,
  baseUrl,
  fetch: hostHeader ? fetchWithHostHeader : undefined,
});

let CREATED = 0;
let REUSED = 0;
let ENDPOINTS_ADDED = 0;
let FAILED = 0;

// A connector config file is a complete CreateConnectorInput, with endpoints
// always declared (unlike the SDK type, where they're optional).
interface ConnectorConfig extends CreateConnectorInput {
  endpoints: CreateConnectorEndpointInput[];
}

// renderConnector <file> — parse the connector body, applying basic-auth env
// overrides. For authType "basic": sets basicUsername/basicPassword and
// rewrites any /basic-auth or /hidden-basic-auth endpoint path to embed the
// same creds, so the sent Authorization header always matches httpbin's URL
// expectation.
function renderConnector(file: string): ConnectorConfig {
  const raw = fs.readFileSync(file, "utf8");
  const config = JSON.parse(raw) as ConnectorConfig;

  if (config.authType !== "basic") {
    return config;
  }

  const basicAuthPath = /^(\/(?:hidden-)?basic-auth)\//;
  return {
    ...config,
    authConfig: {
      ...config.authConfig,
      basicUsername: BASIC_USER,
      basicPassword: BASIC_PASS,
    },
    endpoints: config.endpoints.map((ep) => {
      const match = basicAuthPath.exec(ep.path ?? "");
      if (!match) {
        return ep;
      }
      return { ...ep, path: `${match[1]}/${BASIC_USER}/${BASIC_PASS}` };
    }),
  };
}

// resolveIdByName <name> — return the id of the connector with this name, or
// undefined. Auto-heals duplicates: if more than one connector shares the
// name, deletes the extras (all but the first) and warns. Returns the
// surviving id.
async function resolveIdByName(name: string): Promise<string | undefined> {
  const all: Connector[] = [];
  for await (const connector of client.connectors.list({ context: CONTEXT })) {
    all.push(connector);
  }
  const matching = all.filter((c) => c.name === name);

  if (matching.length > 1) {
    warn(
      `duplicate connectors named '${name}' (${matching.length} found) — auto-healing, keeping first`
    );
    for (const stale of matching.slice(1)) {
      log(`  deleting duplicate connector ${stale.id}`);
      await client.connectors.remove(stale.id).catch(() => undefined);
    }
  }

  return matching[0]?.id;
}

// reconcileEndpoints <id> <name> <config> — add any config endpoint whose
// (method, path) isn't already registered on the connector.
async function reconcileEndpoints(
  id: string,
  name: string,
  config: ConnectorConfig
): Promise<void> {
  const current = await client.connectors.get(id);
  let added = 0;

  for (const ep of config.endpoints) {
    const exists = current.endpoints.some(
      (e) => e.method === ep.method && e.path === ep.path
    );
    if (exists) {
      continue;
    }

    try {
      await client.connectors.addEndpoint(id, ep);
      log(`    + ${ep.method} ${ep.path}  (${ep.label})`);
      added += 1;
      ENDPOINTS_ADDED += 1;
    } catch (e) {
      if (e instanceof ConflictError) {
        // raced with a concurrent run — already present, fine
        continue;
      }
      warn(`    ! ${ep.method} ${ep.path} failed: ${messageOf(e)}`);
      FAILED += 1;
    }
  }

  if (added === 0) {
    log("    endpoints already up to date");
  }
}

// reconcileAdapterConfig <id> <name> <config> — PATCH the connector's
// declarative config fields (currently just defaultCache) so an existing
// connector picks up config changes on re-run.
async function reconcileAdapterConfig(
  id: string,
  name: string,
  config: ConnectorConfig
): Promise<void> {
  if (!config.defaultCache) {
    return;
  }

  try {
    await client.connectors.update(id, { defaultCache: config.defaultCache });
    log(`    config reconciled for '${name}'`);
  } catch (e) {
    warn(`    ! config reconcile failed for '${name}': ${messageOf(e)}`);
    FAILED += 1;
  }
}

// upsertConnector <file> — ensure the connector exists, then reconcile its
// config and endpoints. Idempotent end to end.
async function upsertConnector(file: string): Promise<void> {
  const config = renderConnector(file);
  const name = config.name;
  if (!name) {
    err(`config has no .name: ${file}`);
    FAILED += 1;
    return;
  }

  let id = await resolveIdByName(name);

  if (id) {
    log(`reuse  '${name}' — exists (id=${id})`);
    REUSED += 1;
  } else {
    // Create the connector with NO inline endpoints, then let reconcile add
    // them all — so every endpoint addition is logged + counted uniformly,
    // whether the connector is brand new or pre-existing.
    try {
      const created = await client.connectors.create({
        ...config,
        endpoints: [],
      });
      id = created.id;
      log(`create '${name}' (auth=${config.authType}) -> id=${id}`);
      CREATED += 1;
    } catch (e) {
      if (e instanceof ConflictError) {
        // Lost a race — re-resolve and continue to endpoint reconcile.
        id = await resolveIdByName(name);
        warn(
          `reuse  '${name}' — create returned 'already exists' (idempotent)`
        );
        REUSED += 1;
      } else {
        err(`create FAILED for '${name}': ${messageOf(e)}`);
        FAILED += 1;
        return;
      }
    }
  }

  if (!id) {
    err(`could not resolve id for '${name}' — skipping endpoint reconcile`);
    FAILED += 1;
    return;
  }

  await reconcileAdapterConfig(id, name, config);
  await reconcileEndpoints(id, name, config);
}

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): string[] {
  step("0/3 preflight");

  if (!fs.existsSync(CONNECTORS_DIR)) {
    fail(`connectors dir not found: ${CONNECTORS_DIR}`);
  }

  const files = fs
    .readdirSync(CONNECTORS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(CONNECTORS_DIR, f));

  if (files.length === 0) {
    fail(`no connector configs (*.json) in ${CONNECTORS_DIR}`);
  }

  // Fail fast on a malformed config rather than half-provisioning.
  for (const file of files) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      fail(`invalid JSON: ${file} (${messageOf(e)})`);
    }
  }

  log(
    `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  context=${CONTEXT}  configs=${files.length}  recreate=${RECREATE}`
  );
  log(
    `basic-auth creds: ${BASIC_USER}/${BASIC_PASS} (override via HTTPBIN_BASIC_USER / HTTPBIN_BASIC_PASS)`
  );

  return files;
}

// ----- Stage recreate (optional): wipe all context=external connectors ------
async function stageRecreate(): Promise<void> {
  if (RECREATE !== "1") {
    return;
  }
  step(`recreate — deleting all context=${CONTEXT} connectors`);
  for await (const connector of client.connectors.list({ context: CONTEXT })) {
    log(`  deleting connector ${connector.id}`);
    await client.connectors.remove(connector.id).catch(() => undefined);
  }
  log("recreate done — provision will recreate from config files");
}

// ----- Stage 2: upsert every connector + reconcile its endpoints -----------
async function stageProvision(files: string[]): Promise<void> {
  step(`2/3 upsert connectors from ${CONNECTORS_DIR}`);
  for (const file of files) {
    await upsertConnector(file);
  }
}

// ----- Stage 3: summary ------------------------------------------------------
function stageSummary(): void {
  step("3/3 summary");
  log(
    `connectors: created=${CREATED}  reused=${REUSED}   endpoints added=${ENDPOINTS_ADDED}   failed=${FAILED}`
  );
  console.log();
  log(`List them:  curl -s "${baseUrl}/api/connectors?context=${CONTEXT}" \\`);
  log(
    `              -H 'Host: ${hostHeader ?? ""}' -H 'x-yoizen-tenant: ${tenant}' \\`
  );
  log(
    `              -H "Authorization: Bearer $TOKEN" | jq '.[] | {name, authType, endpoints: (.endpoints|length)}'`
  );
  log("Call one from a workflow via an 'endpointCall' action — see README.md.");

  if (FAILED > 0) {
    fail(`${FAILED} operation(s) failed — see [ERR]/[WARN] lines above.`);
  }
}

export async function provisionConnectors(): Promise<void> {
  const files = stagePreflight();
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
  await stageRecreate();
  await stageProvision(files);
  stageSummary();
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  provisionConnectors().catch((e) => {
    err(`failed: ${messageOf(e)}`);
    process.exit(1);
  });
}
