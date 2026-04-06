import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { evictOldestIfCapacityBeforeSet, TENANT_HEADER } from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { proxyServiceConfig } from "../../config";

const PROXY_TARGET_HEADER = "x-proxy-target";
const PROXY_TIMEOUT_MS = 30_000;
const TENANT_CACHE_TTL_MS = 60_000;
const TENANT_CACHE_MAX = 512;

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "accept-encoding",
]);

type TenantUrlConfigKey = "ySocialUrl" | "yFlowUrl";

const TENANT_PROXY_PATH_PREFIX: Record<TenantUrlConfigKey, string> = {
  ySocialUrl: "/proxy/ysocial",
  yFlowUrl: "/proxy/yflow",
};

const TENANT_PROXY_MISSING_URL_MSG: Record<TenantUrlConfigKey, string> = {
  ySocialUrl: "Tenant does not have ySocialUrl configured",
  yFlowUrl: "Tenant does not have yFlowUrl configured",
};

interface ICacheEntry {
  config: Record<string, unknown>;
  expiresAt: number;
}

/** Tenant-scoped proxy: base URL from tenant config + path under prefix. */
interface ITenantProxyParams {
  readonly tenantId: string;
  readonly req: FastifyRequest;
  readonly reply: FastifyReply;
  readonly configKey: TenantUrlConfigKey;
}

@Injectable()
export class ProxyService {
  private readonly logger = new PinoLoggerService(ProxyService.name);
  private readonly tenantServiceUrl: string;
  private readonly tenantCache = new Map<string, ICacheEntry>();

  constructor() {
    this.tenantServiceUrl = proxyServiceConfig.tenantServiceUrl;
  }

  async handleGeneric(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const target = req.headers[PROXY_TARGET_HEADER] as string | undefined;
    if (!target) {
      throw new BadRequestException("Missing x-proxy-target header");
    }

    const upstreamPath = extractPath(req.url, "/proxy/generic");
    const queryString = extractQuery(req.url);
    const url = `${target}${upstreamPath}${queryString}`;

    await this.proxyTo(url, req, reply);
  }

  async handleYSocial(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.handleTenantScopedProxy(req, reply, "ySocialUrl");
  }

  async handleYFlow(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.handleTenantScopedProxy(req, reply, "yFlowUrl");
  }

  private async handleTenantScopedProxy(
    req: FastifyRequest,
    reply: FastifyReply,
    configKey: TenantUrlConfigKey,
  ): Promise<void> {
    const tenantId = req.headers[TENANT_HEADER] as string | undefined;
    if (!tenantId) {
      throw new BadRequestException("Missing tenant header");
    }
    await this.handleTenantProxy({ tenantId, req, reply, configKey });
  }

  private async handleTenantProxy(params: ITenantProxyParams): Promise<void> {
    const { tenantId, req, reply, configKey } = params;
    const config = await this.getTenantConfig(tenantId);
    if (!config) {
      throw new NotFoundException(`Tenant '${tenantId}' not found`);
    }

    const baseUrl = config[configKey] as string | undefined;
    if (!baseUrl) {
      throw new UnprocessableEntityException(
        TENANT_PROXY_MISSING_URL_MSG[configKey],
      );
    }

    const pathPrefix = TENANT_PROXY_PATH_PREFIX[configKey];
    const upstreamPath = extractPath(req.url, pathPrefix);
    const queryString = extractQuery(req.url);
    const url = `${baseUrl}${upstreamPath}${queryString}`;

    await this.proxyTo(url, req, reply);
  }

  private async proxyTo(
    url: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const upstreamHeaders: Record<string, string> = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key)) continue;
      if (typeof val === "string") upstreamHeaders[key] = val;
    }

    upstreamHeaders["accept-encoding"] = "identity";

    const init: RequestInit = {
      method: req.method,
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    };

    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.body !== undefined
    ) {
      init.body = JSON.stringify(req.body);
    }

    try {
      const upstream = await tracedFetch(url, init);

      reply.status(upstream.status);

      upstream.headers.forEach((value, key) => {
        if (key === "transfer-encoding" || key === "connection") return;
        reply.header(key, value);
      });

      const body = await upstream.text();
      reply.send(body);
    } catch (err) {
      this.logger.error(`Proxy error for ${req.method} ${url}: ${err}`);
      throw new BadGatewayException("Bad Gateway");
    }
  }

  private async getTenantConfig(
    tenantId: string,
  ): Promise<Record<string, unknown> | null> {
    const now = Date.now();
    const cached = this.tenantCache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached.config;

    try {
      const res = await tracedFetch(
        `${this.tenantServiceUrl}/tenants/${encodeURIComponent(tenantId)}`,
        { signal: AbortSignal.timeout(5_000) },
      );

      if (res.status === 404) {
        this.tenantCache.delete(tenantId);
        return null;
      }

      if (!res.ok) {
        this.logger.error(
          `Tenant service responded ${res.status} for tenant '${tenantId}'`,
        );
        return cached?.config ?? null;
      }

      const tenant = (await res.json()) as {
        configuration?: Record<string, unknown>;
      };
      const config = tenant.configuration ?? {};

      evictOldestIfCapacityBeforeSet(
        this.tenantCache,
        TENANT_CACHE_MAX,
        tenantId,
      );

      this.tenantCache.set(tenantId, {
        config,
        expiresAt: now + TENANT_CACHE_TTL_MS,
      });

      return config;
    } catch (err) {
      this.logger.error(
        `Failed to fetch tenant config for '${tenantId}': ${err}`,
      );
      return cached?.config ?? null;
    }
  }
}

function extractPath(fullUrl: string, prefix: string): string {
  const pathOnly = fullUrl.split("?")[0];
  const remainder = pathOnly.slice(prefix.length);
  return remainder || "/";
}

function extractQuery(fullUrl: string): string {
  const idx = fullUrl.indexOf("?");
  return idx >= 0 ? fullUrl.slice(idx) : "";
}
