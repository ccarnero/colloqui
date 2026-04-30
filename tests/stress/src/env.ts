const DEFAULTS = {
  API_PREFIX: "/api",
  KOURIER_HOST: "localhost",
  KOURIER_PORT: "8080",
  MINIKUBE_DOMAIN: "192.168.49.2.sslip.io",
  NAMESPACE: "platform-services-dev",
  TARGET: "http://localhost:8080",
  TENANT: "acme",
} as const;

interface RuntimeConfig {
  apiPrefix: string;
  hostHeader: string | null;
  rawGatewayBaseUrl: string;
  targetBaseUrl: string;
  tenant: string;
}

const runtimeConfigCache = new Map<string, RuntimeConfig>();

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return url.toString().replace(/\/$/, "");
}

function buildKnativeGatewayUrl(namespace: string, minikubeDomain: string): string {
  return `http://api-gateway.${namespace}.${minikubeDomain}`;
}

function getEnvCacheKey(): string {
  return [
    process.env.STRESS_TARGET ?? "",
    process.env.API_GATEWAY_URL ?? "",
    process.env.SMOKE_TEST_NAMESPACE ?? "",
    process.env.MINIKUBE_DOMAIN ?? "",
    process.env.KOURIER_HOST ?? "",
    process.env.KOURIER_PORT ?? "",
    process.env.E2E_TENANT ?? "",
    process.env.STRESS_API_PREFIX ?? "",
  ].join("|");
}

function computeRuntimeConfig(): RuntimeConfig {
  const namespace = process.env.SMOKE_TEST_NAMESPACE ?? DEFAULTS.NAMESPACE;
  const minikubeDomain = process.env.MINIKUBE_DOMAIN ?? DEFAULTS.MINIKUBE_DOMAIN;
  const apiPrefix = process.env.STRESS_API_PREFIX ?? DEFAULTS.API_PREFIX;
  const tenant = process.env.E2E_TENANT ?? DEFAULTS.TENANT;

  const knativeBase = buildKnativeGatewayUrl(namespace, minikubeDomain);
  const rawGatewayBaseUrl = normalizeBaseUrl(
    process.env.API_GATEWAY_URL ?? knativeBase
  );
  const explicitTarget = process.env.STRESS_TARGET;
  if (explicitTarget) {
    return {
      apiPrefix,
      hostHeader: null,
      rawGatewayBaseUrl,
      targetBaseUrl: normalizeBaseUrl(explicitTarget),
      tenant,
    };
  }

  const kourierHost = process.env.KOURIER_HOST ?? DEFAULTS.KOURIER_HOST;
  const kourierPort = process.env.KOURIER_PORT ?? DEFAULTS.KOURIER_PORT;

  return {
    apiPrefix,
    hostHeader: new URL(rawGatewayBaseUrl).hostname,
    rawGatewayBaseUrl,
    targetBaseUrl: normalizeBaseUrl(`http://${kourierHost}:${kourierPort}`),
    tenant,
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  const key = getEnvCacheKey();
  const cached = runtimeConfigCache.get(key);
  if (cached) {
    return cached;
  }

  const computed = computeRuntimeConfig();
  runtimeConfigCache.set(key, computed);
  return computed;
}

export function resolveRequestUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }

  const runtime = getRuntimeConfig();
  const normalizedPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${runtime.targetBaseUrl}${normalizedPath}`;
}

export function resolveGatewayApiUrl(path: string): string {
  const runtime = getRuntimeConfig();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return resolveRequestUrl(`${runtime.apiPrefix}${normalizedPath}`);
}

export function buildGatewayHeaders(
  extraHeaders?: Readonly<Record<string, string>>
): Record<string, string> {
  const runtime = getRuntimeConfig();
  const mergedHeaders = new Map<string, string>();

  if (runtime.hostHeader) {
    mergedHeaders.set("Host", runtime.hostHeader);
  }

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      mergedHeaders.set(key, value);
    }
  }

  return Object.fromEntries(mergedHeaders);
}
