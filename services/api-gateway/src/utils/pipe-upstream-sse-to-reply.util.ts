import { PinoLoggerService } from "@yoizen/observability";
import type { FastifyReply } from "fastify";

const logger = new PinoLoggerService("pipe-upstream-sse-to-reply");

/** Heartbeat cadence — keeps Knative activator / ingress / client proxies
 * from idling out the long-lived connection (DOCS/architecture/runtime-streaming.md §6). */
const HEARTBEAT_INTERVAL_MS = 15_000;

export interface PipeUpstreamSseOptions {
  /** Upstream URL to POST the request body to. */
  upstreamUrl: string;
  /** Headers forwarded to the upstream request (tenant, trusted-user, etc). */
  headers: Record<string, string>;
  /** JSON-serializable request body. */
  body: unknown;
}

/**
 * Streams an upstream SSE POST response through to the client without
 * buffering — sibling to `pipeUpstreamResponseToReply` (which buffers via
 * `upstream.text()` and must NOT be touched; `proxy.hook.ts` and
 * `runtime-proxy.service.ts`'s buffered JSON proxy depend on that one
 * staying byte-for-byte).
 *
 * This is the ONLY streaming passthrough path in api-gateway
 * (DOCS/architecture/runtime-streaming.md §3.4):
 * 1. `reply.hijack()` — detaches Fastify's response lifecycle so no
 *    interceptor/serializer touches the streamed body.
 * 2. Writes SSE headers directly to `reply.raw`.
 * 3. `fetch()`s the upstream with an `AbortController`, pipes each chunk of
 *    `res.body` to `reply.raw` as it arrives.
 * 4. `reply.raw.on("close", ...)` aborts the upstream fetch — propagates a
 *    client disconnect one hop up (§2.2).
 * 5. Emits a `:hb\n\n` comment line every ~15s to defeat idle timeouts.
 */
export async function pipeUpstreamSseToReply(
  reply: FastifyReply,
  options: PipeUpstreamSseOptions
): Promise<void> {
  reply.hijack();

  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const controller = new AbortController();

  const onClose = (): void => {
    controller.abort();
  };
  raw.on("close", onClose);

  const heartbeat = setInterval(() => {
    if (!raw.destroyed && raw.writable) {
      raw.write(":hb\n\n");
    }
  }, HEARTBEAT_INTERVAL_MS);

  const stopHeartbeat = (): void => {
    clearInterval(heartbeat);
  };

  try {
    const upstreamResponse = await fetch(options.upstreamUrl, {
      method: "POST",
      headers: {
        ...options.headers,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      raw.write(
        `event: failed\ndata: ${JSON.stringify({ reason: `upstream_status_${upstreamResponse.status}` })}\n\n`
      );
      return;
    }

    const reader = upstreamResponse.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (raw.destroyed || !raw.writable) {
        break;
      }
      raw.write(value);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      logger.warn(`SSE passthrough error: ${error}`);
      if (!raw.destroyed && raw.writable) {
        raw.write(
          `event: failed\ndata: ${JSON.stringify({ reason: "upstream_error" })}\n\n`
        );
      }
    }
  } finally {
    stopHeartbeat();
    raw.off("close", onClose);
    if (!raw.destroyed) {
      raw.end();
    }
  }
}
