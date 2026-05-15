/**
 * Phase 1 — runtime configuration helpers (k6 + Bun shared).
 *
 * Reads environment variables once and exports a memoised, immutable config.
 * No Node imports here so the same module is consumable from k6 and Bun.
 */

const DEFAULTS = Object.freeze({
    API_PREFIX: "/api",
    KOURIER_HOST: "localhost",
    KOURIER_PORT: "8080",
    MINIKUBE_DOMAIN: "10.107.168.96.sslip.io",
    NAMESPACE: "platform-services-dev",
    SINK_URL: "http://stress-sink.platform-services-dev.svc.cluster.local/sink",
    TARGET: "http://localhost:8080",
    TENANT: "acme",
  });
  
  export interface RuntimeConfig {
    readonly apiPrefix: string;
    readonly hostHeader: string | null;
    readonly namespace: string;
    readonly rawGatewayBaseUrl: string;
    readonly sinkUrl: string;
    readonly targetBaseUrl: string;
    readonly tenant: string;
  }
  
  interface EnvBag {
    readonly [key: string]: string | undefined;
  }
  
  const configCache = new Map<string, RuntimeConfig>();
  
  function readEnv(): EnvBag {
    const k6Env = (globalThis as { __ENV?: Record<string, string | undefined> })
      .__ENV;
    if (k6Env) {
      return k6Env;
    }
    const proc = (
      globalThis as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process;
    return proc?.env ?? {};
  }
  
  function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/u, "");
  }
  
  function buildKnativeGatewayUrl(
    namespace: string,
    minikubeDomain: string
  ): string {
    return `http://api-gateway.${namespace}.${minikubeDomain}`;
  }
  
  function envCacheKey(env: EnvBag): string {
    return [
      env.STRESS_TARGET ?? "",
      env.API_GATEWAY_URL ?? "",
      env.SMOKE_TEST_NAMESPACE ?? "",
      env.STRESS_NAMESPACE ?? "",
      env.MINIKUBE_DOMAIN ?? "",
      env.KOURIER_HOST ?? "",
      env.KOURIER_PORT ?? "",
      env.E2E_TENANT ?? "",
      env.STRESS_API_PREFIX ?? "",
      env.STRESS_SINK_URL ?? "",
    ].join("|");
  }
  
  function extractHostname(url: string): string | null {
    const match = /^https?:\/\/([^/:?#]+)/u.exec(url);
    return match ? (match[1] ?? null) : null;
  }
  
  function computeRuntimeConfig(env: EnvBag): RuntimeConfig {
    const namespace =
      env.STRESS_NAMESPACE ?? env.SMOKE_TEST_NAMESPACE ?? DEFAULTS.NAMESPACE;
    const minikubeDomain = env.MINIKUBE_DOMAIN ?? DEFAULTS.MINIKUBE_DOMAIN;
    const apiPrefix = env.STRESS_API_PREFIX ?? DEFAULTS.API_PREFIX;
    const tenant = env.E2E_TENANT ?? DEFAULTS.TENANT;
    const sinkUrl = env.STRESS_SINK_URL ?? DEFAULTS.SINK_URL;
  
    const knativeBase = buildKnativeGatewayUrl(namespace, minikubeDomain);
    const rawGatewayBaseUrl = normalizeBaseUrl(
      env.API_GATEWAY_URL ?? knativeBase
    );
  
    const explicitTarget = env.STRESS_TARGET;
    if (explicitTarget) {
      return Object.freeze({
        apiPrefix,
        hostHeader: null,
        namespace,
        rawGatewayBaseUrl,
        sinkUrl,
        targetBaseUrl: normalizeBaseUrl(explicitTarget),
        tenant,
      });
    }
  
    const kourierHost = env.KOURIER_HOST ?? DEFAULTS.KOURIER_HOST;
    const kourierPort = env.KOURIER_PORT ?? DEFAULTS.KOURIER_PORT;
  
    return Object.freeze({
      apiPrefix,
      hostHeader: extractHostname(rawGatewayBaseUrl),
      namespace,
      rawGatewayBaseUrl,
      sinkUrl,
      targetBaseUrl: normalizeBaseUrl(`http://${kourierHost}:${kourierPort}`),
      tenant,
    });
  }
  
  export function getRuntimeConfig(): RuntimeConfig {
    const env = readEnv();
    const key = envCacheKey(env);
    const cached = configCache.get(key);
    if (cached) {
      return cached;
    }
  
    const computed = computeRuntimeConfig(env);
    configCache.set(key, computed);
    return computed;
  }
  
  export function resolveRequestUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
      return pathOrUrl;
    }
    const runtime = getRuntimeConfig();
    const normalized = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${runtime.targetBaseUrl}${normalized}`;
  }
  
  export function resolveGatewayApiUrl(path: string): string {
    const runtime = getRuntimeConfig();
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return resolveRequestUrl(`${runtime.apiPrefix}${normalized}`);
  }
  
  export function buildGatewayHeaders(
    extraHeaders?: Readonly<Record<string, string>>
  ): Record<string, string> {
    const runtime = getRuntimeConfig();
    const merged = new Map<string, string>();
  
    merged.set("Content-Type", "application/json");
    if (runtime.hostHeader) {
      merged.set("Host", runtime.hostHeader);
    }
  
    if (extraHeaders) {
      for (const [key, value] of Object.entries(extraHeaders)) {
        merged.set(key, value);
      }
    }
  
    const headers: Record<string, string> = {};
    for (const [key, value] of merged) {
      headers[key] = value;
    }
    return headers;
  }
  