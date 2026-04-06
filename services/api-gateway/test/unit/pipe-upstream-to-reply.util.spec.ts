import { describe, it, expect, mock } from "bun:test";
import type { FastifyReply } from "fastify";
import { pipeUpstreamResponseToReply } from "../../src/utils/pipe-upstream-to-reply.util";

describe("pipeUpstreamResponseToReply", () => {
  it("sets status, forwards headers except hop-by-hop, sends body text", async () => {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    headers.set("transfer-encoding", "chunked");
    headers.set("connection", "keep-alive");
    headers.set("x-custom", "ok");

    const upstream = new Response('{"a":1}', {
      status: 201,
      headers,
    });

    const reply = {
      status: mock((code: number) => reply),
      header: mock(() => reply),
      send: mock(() => reply),
    } as unknown as FastifyReply;

    await pipeUpstreamResponseToReply(reply, upstream);

    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.header).toHaveBeenCalledWith("content-type", "application/json");
    expect(reply.header).toHaveBeenCalledWith("x-custom", "ok");
    expect(reply.header).not.toHaveBeenCalledWith("transfer-encoding", expect.anything());
    expect(reply.header).not.toHaveBeenCalledWith("connection", expect.anything());
    expect(reply.send).toHaveBeenCalledWith('{"a":1}');
  });
});
