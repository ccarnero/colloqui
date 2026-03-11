import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppModule } from './app.module';
import { DynamicRouteCacheService } from './modules/dynamic-routes/dynamic-route-cache.service';
import { JwtService } from './modules/auth/jwt.service';
import { TENANT_HEADER } from '@yoizen/shared';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const PLATFORM_PREFIXES = [
  '/events',
  '/audit',
  '/tenants',
  '/schedulers',
  '/registry',
  '/workflows',
  '/proxy',
  '/health',
  '/auth',
];

const HOST_PATTERN = /^[^.]+\.([^.]+)\.yplatform\.com$/;
const PROXY_TIMEOUT_MS = 30_000;

function resolveTenantFromRequest(req: FastifyRequest): string | null {
  const header = req.headers[TENANT_HEADER] as string | undefined;
  if (header) return header;

  const host = req.headers.host ?? '';
  const match = HOST_PATTERN.exec(host);
  if (match) return match[1];

  return null;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const routeCache = app.get(DynamicRouteCacheService);
  const jwtService = app.get(JwtService);
  const logger = new Logger('DynamicRouteHook');

  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook(
    'onRequest',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const path = req.url.split('?')[0];

      for (let i = 0; i < PLATFORM_PREFIXES.length; i++) {
        if (path.startsWith(PLATFORM_PREFIXES[i])) return;
      }

      const tenantId = resolveTenantFromRequest(req);
      if (!tenantId) return;

      const matched = routeCache.match(tenantId, req.method, path);
      if (!matched) return;

      if (!matched.isPublic) {
        const authHeader = (req.headers.authorization ??
          req.headers.Authorization) as string | undefined;
        if (!authHeader) {
          reply.status(401).send({ statusCode: 401, message: 'Missing Authorization header' });
          return;
        }
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
          reply.status(401).send({ statusCode: 401, message: 'Invalid Authorization header format' });
          return;
        }
        try {
          const payload = await jwtService.verify(parts[1]);
          const scope = payload.scope as string;
          if (scope !== 'platform' && scope !== `tenant:${tenantId}`) {
            reply.status(403).send({ statusCode: 403, message: 'Token scope does not match tenant' });
            return;
          }
        } catch {
          reply.status(401).send({ statusCode: 401, message: 'Invalid or expired token' });
          return;
        }
      }

      const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const upstreamUrl =
        `http://${matched.knativeName}.${matched.namespace}.svc.cluster.local${matched.upstreamPath}${queryString}`;

      const upstreamHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(req.headers)) {
        if (key === 'host' || key === 'connection' || key === 'transfer-encoding') continue;
        if (typeof val === 'string') upstreamHeaders[key] = val;
      }

      const init: RequestInit = {
        method: req.method,
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      };

      if (
        req.method !== 'GET' &&
        req.method !== 'HEAD' &&
        req.method !== 'DELETE' &&
        req.body !== undefined
      ) {
        init.body = JSON.stringify(req.body);
      }

      try {
        const upstream = await fetch(upstreamUrl, init);

        reply.status(upstream.status);

        upstream.headers.forEach((value, key) => {
          if (key === 'transfer-encoding' || key === 'connection') return;
          reply.header(key, value);
        });

        const body = await upstream.text();
        reply.send(body);
      } catch (err) {
        logger.error(`Dynamic route proxy error for ${req.method} ${upstreamUrl}: ${err}`);
        reply.status(502).send({ statusCode: 502, message: 'Bad Gateway' });
      }
    },
  );

  await app.listen(PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
