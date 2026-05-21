/**
 * Pre-test warmup: drives the Knative scale-from-zero of the platform
 * fleet before the first `it()` runs.
 *
 * Loaded via `bunfig.toml`'s `[test].preload`, so it executes once per
 * `bun test` invocation, before any spec file is imported. Top-level
 * `await` is honored, so we can pause the runner until the gateway
 * aggregator reports `status: ok`.
 *
 * Why this exists
 * ───────────────
 * Phase-1 of the cost-efficiency plan introduced `min-scale: 0` (Knative)
 * and `idleReplicaCount: 0` (KEDA) for ~14 services in non-prod overlays.
 * The first request after an idle window pays a 10-30s cold-start tax;
 * `bun:test`'s 5s default per-test budget kills any spec that triggers it.
 *
 * Strategy
 * ────────
 * We hit `${API_GATEWAY_URL}/health` repeatedly. The gateway's
 * `GatewayHealthService.checkServices()` fans out an HTTP probe to every
 * downstream listed in `gateway-health.service.ts`. After the Phase 1.5
 * api↔worker split, the *-api Knative Service is the HTTP target — the
 * gateway maps logical names (`audit-service`, `metrics-service`, …) to
 * the corresponding `*-api` URL via `gatewayConfig.services`. Even when
 * the 3s per-target timeout aborts the call, Knative's Activator has
 * already started scaling the target pod from 0, so successive polls
 * see the aggregate flip from `degraded` → `ok`.
 *
 * Why not poke each service directly?
 *   The `port-forward.sh` workflow only exposes `api-gateway` on
 *   localhost:8080 — there's no Kourier ingress port-forward, so direct
 *   `<svc>.<ns>.<domain>/health` calls would have no path. Going through
 *   the gateway also exercises the same proxy chain the suite uses,
 *   which means a green warmup is a strong signal the suite can run.
 *
 * NOTE: `workflow-worker` and `http-adapter` are NOT in the
 * gateway aggregator (they're consumers, not HTTP-callable APIs). The
 * first test that triggers a workflow execution will pay their
 * cold-start; per-test timeouts in `workflow.e2e.spec.ts` and
 * `adapter.e2e.spec.ts` are sized to absorb that.
 */

export {};

declare const Bun: { sleep: (ms: number) => Promise<void> };

const NAMESPACE = process.env.SMOKE_TEST_NAMESPACE ?? "platform-services-dev";
const KOURIER_HOST = process.env.KOURIER_HOST ?? "localhost";
const KOURIER_PORT = process.env.KOURIER_PORT ?? "8080";
const MINIKUBE_DOMAIN = process.env.MINIKUBE_DOMAIN ?? "192.168.49.2.sslip.io";

const WARMUP_BUDGET_MS = Number(process.env.E2E_WARMUP_TIMEOUT_MS ?? 180_000);
const WARMUP_PROBE_TIMEOUT_MS = 30_000;
const WARMUP_DISABLED = process.env.E2E_WARMUP_DISABLE === "1";

interface GatewayHealthBody {
  status: string;
  nats?: string;
  redis?: string;
  services?: Record<string, unknown>;
}

function gatewayHealthUrl(): string {
  if (process.env.API_GATEWAY_URL) {
    return `${process.env.API_GATEWAY_URL}/health`;
  }
  return `http://api-gateway.${NAMESPACE}.${MINIKUBE_DOMAIN}/health`;
}

/**
 * Routes the request via Kourier (port-forward on KOURIER_HOST:KOURIER_PORT)
 * and injects the original hostname as a Host header — same pattern as
 * `helpers.ts#resolveRequest`. Kept inline here so warmup never imports
 * helpers (which would compile its own retry stack and complicate logs).
 */
function resolveRequest(url: string): [string, RequestInit] {
  const parsed = new URL(url);
  if (!KOURIER_HOST || !KOURIER_PORT) {
    return [parsed.toString(), {}];
  }
  const hostHeader = parsed.hostname;
  parsed.hostname = KOURIER_HOST;
  parsed.port = KOURIER_PORT;
  const headers = new Headers();
  headers.set("Host", hostHeader);
  return [parsed.toString(), { headers }];
}

async function probeGateway(): Promise<{
  status: number;
  body: GatewayHealthBody | null;
  error?: string;
}> {
  const [url, init] = resolveRequest(gatewayHealthUrl());
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(WARMUP_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { status: res.status, body: null, error: `http ${res.status}` };
    }
    const body = (await res.json()) as GatewayHealthBody;
    return { status: res.status, body };
  } catch (e: unknown) {
    return {
      status: 0,
      body: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function summarizeBody(body: GatewayHealthBody | null): string {
  if (!body) return "(no body)";
  const downstreams = body.services ? Object.entries(body.services) : [];
  const unreachable = downstreams
    .filter(([, v]) => v === "unreachable")
    .map(([k]) => k);
  if (unreachable.length === 0) {
    return `status=${body.status}`;
  }
  return `status=${body.status}, unreachable=[${unreachable.join(", ")}]`;
}

async function runWarmup(): Promise<void> {
  if (WARMUP_DISABLED) {
    console.log("[warmup] skipped (E2E_WARMUP_DISABLE=1)");
    return;
  }

  const url = gatewayHealthUrl();
  const suiteStart = Date.now();
  const deadline = suiteStart + WARMUP_BUDGET_MS;

  console.log(
    `[warmup] driving scale-from-zero via ${url} ` +
      `(budget=${WARMUP_BUDGET_MS}ms, kourier=${KOURIER_HOST}:${KOURIER_PORT})`,
  );

  let attempt = 0;
  let delay = 1_000;
  let lastSummary = "";

  while (Date.now() < deadline) {
    attempt++;
    const result = await probeGateway();
    const summary =
      result.error != null
        ? `error=${result.error}`
        : summarizeBody(result.body);

    if (summary !== lastSummary) {
      const elapsed = ((Date.now() - suiteStart) / 1000).toFixed(1);
      console.log(`[warmup] +${elapsed}s attempt=${attempt} ${summary}`);
      lastSummary = summary;
    }

    if (result.body?.status === "ok") {
      const elapsed = ((Date.now() - suiteStart) / 1000).toFixed(1);
      console.log(`[warmup] gateway converged to OK in ${elapsed}s after ${attempt} probes`);
      return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await Bun.sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, 5_000);
  }

  // Non-fatal: per-request retries in helpers.ts will absorb residual
  // cold-starts. We just want loud logs so the dev knows where to look
  // if the suite fails downstream.
  const elapsed = ((Date.now() - suiteStart) / 1000).toFixed(1);
  console.log(
    `[warmup] gateway did NOT converge to OK in ${elapsed}s (${attempt} probes). ` +
      `Last state: ${lastSummary}. Continuing — per-request retries will compensate.`,
  );
}

await runWarmup();
