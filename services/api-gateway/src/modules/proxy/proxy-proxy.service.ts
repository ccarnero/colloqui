import { Injectable } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { gatewayConfig } from "../../config";
import { PROXY_TIMEOUT_MS } from "../../constants";
import { copyForwardableHeaders } from "../../utils/copy-forwardable-headers";
import { pipeUpstreamResponseToReply } from "../../utils/pipe-upstream-to-reply.util";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "accept-encoding",
]);

@Injectable()
export class ProxyProxyService {
  private readonly logger = new PinoLoggerService(ProxyProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = gatewayConfig.services.proxy;
  }

  async forward(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const path = req.url;
    const url = `${this.baseUrl}${path}`;

    const upstreamHeaders = copyForwardableHeaders(req, HOP_BY_HOP);
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
      await pipeUpstreamResponseToReply(reply, upstream);
    } catch (err) {
      this.logger.error(
        `Proxy pass-through error for ${req.method} ${url}: ${err}`,
      );
      reply.status(502).send({ statusCode: 502, message: "Bad Gateway" });
    }
  }
}
