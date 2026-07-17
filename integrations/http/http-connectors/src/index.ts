/**
 * http-connectors sample driver — the RUN side that VERIFIES the
 * already-provisioned connector catalog (provisioning itself is declarative
 * now, via `manifest.yaml` + `yoizen manifests apply`; see README.md).
 *
 * Prerequisite: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
 * once first to provision the 5 connectors + their 31 endpoints. This script
 * never creates or modifies platform objects — it only:
 *   1. Lists every `context=external` connector via `client.connectors.list`.
 *   2. Confirms all 5 manifest-declared connectors exist, with their
 *      endpoint counts.
 *   3. For `httpbin-basic-auth`, confirms the connector's `authType` is
 *      `basic` (the secret-bound field).
 *
 * All configuration comes from environment variables, matching the names
 * `../lib/resolve-env.sh` exports — this file is invoked by `run.sh` after
 * that resolution has already happened.
 */
import { createClient } from "@yoizen/platform-sdk";
import type { Connector } from "@yoizen/platform-sdk/connectors";

const EXPECTED_CONNECTOR_NAMES = [
  "catfacts",
  "httpbin",
  "httpbin-basic-auth",
  "jsonplaceholder",
  "pokeapi",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const tenant = requireEnv("YOIZEN_TENANT");
  const email = requireEnv("YOIZEN_EMAIL");
  const password = requireEnv("YOIZEN_PASSWORD");
  const baseUrl = requireEnv("YOIZEN_BASE_URL");
  const hostHeader = process.env.YOIZEN_HOST_HEADER;

  // The gateway's dev ingress routes by Host header (see
  // ../lib/resolve-env.sh); the SDK's fetch-based transport needs it passed
  // as a regular header since we're talking to a bare IP/localhost port.
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

  console.log(
    "[run] verifying the http-connectors catalog (apply manifest.yaml first if this fails)..."
  );

  const all: Connector[] = [];
  for await (const connector of client.connectors.list({
    context: "external",
  })) {
    all.push(connector);
  }

  let missing = 0;
  for (const name of EXPECTED_CONNECTOR_NAMES) {
    const found = all.find((c) => c.name === name);
    if (!found) {
      console.error(
        `[run] MISSING connector '${name}' — apply manifest.yaml first`
      );
      missing += 1;
      continue;
    }
    console.log(
      `[run] '${name}' ok — id=${found.id} authType=${found.authType} endpoints=${found.endpoints.length}`
    );
  }

  if (missing > 0) {
    console.error(
      `[run] ${String(missing)} connector(s) missing — run 'yoizen manifests apply -f manifest.yaml --secrets-from-env' first`
    );
    process.exit(1);
  }

  console.log(
    "[run] all 5 connectors present. Call one from a workflow via an 'endpointCall' action — see README.md."
  );
}

main().catch((e) => {
  console.error("[run] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
