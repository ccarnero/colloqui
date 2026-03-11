import { Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';

const PROXY_TIMEOUT_MS = 30_000;
const HOP_BY_HOP = new Set(['host', 'connection', 'transfer-encoding', 'accept-encoding']);

@Injectable()
export class ProxyProxyService {
  private readonly logger = new Logger(ProxyProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.PROXY_SERVICE_URL ??
      'http://proxy-service.platform-services.svc.cluster.local';
  }

  async forward(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const path = req.url;
    const url = `${this.baseUrl}${path}`;

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
      const upstream = await fetch(url, init);

      reply.status(upstream.status);

      upstream.headers.forEach((value, key) => {
        if (key === 'transfer-encoding' || key === 'connection') return;
        reply.header(key, value);
      });

      const body = await upstream.text();
      reply.send(body);
    } catch (err) {
      this.logger.error(`Proxy pass-through error for ${req.method} ${url}: ${err}`);
      reply.status(502).send({ statusCode: 502, message: 'Bad Gateway' });
    }
  }
}
