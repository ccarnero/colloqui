import { describe, it, expect } from "bun:test";
import type { FastifyRequest } from "fastify";
import { copyForwardableHeaders } from "../../src/utils/copy-forwardable-headers";

describe("copyForwardableHeaders", () => {
  it("copies string headers and skips hop-by-hop names", () => {
    const req = {
      headers: {
        "x-custom": "a",
        host: "api.example.com",
        connection: "keep-alive",
      },
    } as unknown as FastifyRequest;

    const hopByHop = new Set<string>(["host", "connection"]);
    const out = copyForwardableHeaders(req, hopByHop);

    expect(out).toEqual({ "x-custom": "a" });
  });

  it("skips array-valued headers", () => {
    const req = {
      headers: {
        accept: ["text/html", "application/json"],
        "x-one": "ok",
      },
    } as unknown as FastifyRequest;

    const out = copyForwardableHeaders(req, new Set());
    expect(out).toEqual({ "x-one": "ok" });
  });
});
