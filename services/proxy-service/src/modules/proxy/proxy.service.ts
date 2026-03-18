import { Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { TENANT_HEADER } from '@yoizen/shared';
import { tracedFetch } from '@yoizen/observability';

const PROXY_TARGET_HEADER = 'x-proxy-target';
const PROXY_TIMEOUT_MS = 30_000;
const TENANT_CACHE_TTL_MS = 60_000;
const TENANT_CACHE_MAX = 512;

const HOP_BY_HOP = new Set(['host', 'connection', 'transfer-encoding', 'accept-encoding']);

interface CacheEntry {
  config: Record<string, unknown>;
  expiresAt: number;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly tenantServiceUrl: string;
  private readonly tenantCache = new Map<string, CacheEntry>();

  constructor() {
    this.tenantServiceUrl =
      process.env.TENANT_SERVICE_URL ??
      'http://tenant-service.platform-services.svc.cluster.local';
  }

  async handleGeneric(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const target = req.headers[PROXY_TARGET_HEADER] as string | undefined;
    if (!target) {
      reply
        .status(400)
        .send({ statusCode: 400, message: 'Missing x-proxy-target header' });
      return;
    }

    const upstreamPath = extractPath(req.url, '/proxy/generic');
    const queryString = extractQuery(req.url);
    const url = `${target}${upstreamPath}${queryString}`;

    await this.proxyTo(url, req, reply);
  }

  async handleYSocial(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const tenantId = req.headers[TENANT_HEADER] as string | undefined;
    if (!tenantId) {
      reply
        .status(400)
        .send({ statusCode: 400, message: 'Missing tenant header' });
      return;
    }

    const config = await this.getTenantConfig(tenantId);
    if (!config) {
      reply
        .status(404)
        .send({ statusCode: 404, message: `Tenant '${tenantId}' not found` });
      return;
    }

    const ySocialUrl = config.ySocialUrl as string | undefined;
    if (!ySocialUrl) {
      reply.status(422).send({
        statusCode: 422,
        message: 'Tenant does not have ySocialUrl configured',
      });
      return;
    }

    const upstreamPath = extractPath(req.url, '/proxy/ysocial');
    const queryString = extractQuery(req.url);
    const url = `${ySocialUrl}${upstreamPath}${queryString}`;

    await this.proxyTo(url, req, reply);
  }

  async handleYFlow(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const tenantId = req.headers[TENANT_HEADER] as string | undefined;
    if (!tenantId) {
      reply
        .status(400)
        .send({ statusCode: 400, message: 'Missing tenant header' });
      return;
    }

    const config = await this.getTenantConfig(tenantId);
    if (!config) {
      reply
        .status(404)
        .send({ statusCode: 404, message: `Tenant '${tenantId}' not found` });
      return;
    }

    const yFlowUrl = config.yFlowUrl as string | undefined;
    if (!yFlowUrl) {
      reply.status(422).send({
        statusCode: 422,
        message: 'Tenant does not have yFlowUrl configured',
      });
      return;
    }

    const upstreamPath = extractPath(req.url, '/proxy/yflow');
    const queryString = extractQuery(req.url);
    const url = `${yFlowUrl}${upstreamPath}${queryString}`;

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
      if (typeof val === 'string') upstreamHeaders[key] = val;
    }

    upstreamHeaders['accept-encoding'] = 'identity';


    const init: RequestInit = {
      method: req.method,
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      init.body = JSON.stringify(req.body);
    }

    try {
      const upstream = await tracedFetch(url, init);

      reply.status(upstream.status);

      upstream.headers.forEach((value, key) => {
        if (key === 'transfer-encoding' || key === 'connection') return;
        reply.header(key, value);
      });

      const body = await upstream.text();
      reply.send(body);
    } catch (err) {
      this.logger.error(`Proxy error for ${req.method} ${url}: ${err}`);
      reply.status(502).send({ statusCode: 502, message: 'Bad Gateway' });
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

      if (this.tenantCache.size >= TENANT_CACHE_MAX) {
        const firstKey = this.tenantCache.keys().next().value!;
        this.tenantCache.delete(firstKey);
      }

      this.tenantCache.set(tenantId, {
        config,
        expiresAt: now + TENANT_CACHE_TTL_MS,
      });

      return config;
    } catch (err) {
      this.logger.error(`Failed to fetch tenant config for '${tenantId}': ${err}`);
      return cached?.config ?? null;
    }
  }
}

function extractPath(fullUrl: string, prefix: string): string {
  const pathOnly = fullUrl.split('?')[0];
  const remainder = pathOnly.slice(prefix.length);
  return remainder || '/';
}

function extractQuery(fullUrl: string): string {
  const idx = fullUrl.indexOf('?');
  return idx >= 0 ? fullUrl.slice(idx) : '';
}
