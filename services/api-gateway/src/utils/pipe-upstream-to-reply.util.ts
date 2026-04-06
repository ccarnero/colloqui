import type { FastifyReply } from "fastify";

/**
 * Copies upstream `fetch` response status, headers, and body to a Fastify reply.
 * Skips hop-by-hop headers that must not be forwarded.
 */
export async function pipeUpstreamResponseToReply(
  reply: FastifyReply,
  upstream: Response,
): Promise<void> {
  reply.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (key === "transfer-encoding" || key === "connection") return;
    reply.header(key, value);
  });
  const body = await upstream.text();
  reply.send(body);
}
