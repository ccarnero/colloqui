/**
 * Runtime mode helpers for split services (Phase 1.5).
 *
 * Each service is deployed twice: once as a Knative Service (`*-api`) handling
 * HTTP traffic, and once as a plain Kubernetes Deployment (`*-worker`)
 * processing NATS JetStream consumers. Both share the same Docker image and
 * `AppModule` graph; the entry point branches on `SERVICE_MODE` to:
 *
 * - `api`   — bootstrap Fastify, listen on HTTP, skip consumer onModuleInit
 * - `worker`— bootstrap Nest standalone (no HTTP), wire NATS consumers
 *
 * Constant-time enum read (no string compare allocs after first call) — module
 * caches the resolved mode so isWorkerMode/isApiMode are O(1) in hot paths.
 */
export type ServiceMode = "api" | "worker";

const VALID_MODES = new Set<string>(["api", "worker"]);

let cachedMode: ServiceMode | undefined;

/**
 * Resolves the runtime mode for the current process. Defaults to `api` to keep
 * backwards-compat with existing single-pod services (their pods read empty
 * SERVICE_MODE and behave exactly as before).
 *
 * Reads `process.env.SERVICE_MODE` only once and memoizes — safe for hot paths
 * inside `onModuleInit` checks.
 */
export function serviceMode(): ServiceMode {
  if (cachedMode !== undefined) return cachedMode;
  const raw = (process.env.SERVICE_MODE ?? "api").trim().toLowerCase();
  cachedMode = (VALID_MODES.has(raw) ? raw : "api") as ServiceMode;
  return cachedMode;
}

/** True when the current pod runs as a NATS worker (Plain Deployment + KEDA). */
export function isWorkerMode(): boolean {
  return serviceMode() === "worker";
}

/** True when the current pod runs as an HTTP API (Knative Service). */
export function isApiMode(): boolean {
  return serviceMode() === "api";
}

/**
 * Resolves the effective OTEL service name for the running pod, prioritizing
 * `OTEL_SERVICE_NAME` (set by Knative/Deployment manifests) and falling back
 * to `<base>-<mode>` so labels in Prometheus, Tempo, and Loki stay aligned
 * with the deployment role even if the env var is missing.
 *
 * Memoized like `serviceMode()` — single Map lookup amortized over the
 * lifetime of the process.
 */
const serviceNameCache = new Map<string, string>();

export function resolveServiceName(baseServiceName: string): string {
  const cached = serviceNameCache.get(baseServiceName);
  if (cached !== undefined) return cached;
  const fromEnv = process.env.OTEL_SERVICE_NAME?.trim();
  const resolved =
    fromEnv && fromEnv.length > 0
      ? fromEnv
      : `${baseServiceName}-${serviceMode()}`;
  serviceNameCache.set(baseServiceName, resolved);
  return resolved;
}

/**
 * Test-only: clears the memoized mode + service name caches. NEVER call from
 * production code.
 */
export function __resetServiceModeCacheForTests(): void {
  cachedMode = undefined;
  serviceNameCache.clear();
}
