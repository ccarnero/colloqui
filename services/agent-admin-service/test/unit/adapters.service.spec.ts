import "../setup-env";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";

describe("AdaptersService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("findAll returns empty adapters on non-OK response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("err", { status: 502 })),
    ) as typeof fetch;
    const svc = new AdaptersService();
    const out = await svc.findAll("ten-1");
    expect(out.adapters).toEqual([]);
  });

  it("findAll maps sanitized adapters on 200", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: "a1",
              name: "Adapter",
              status: "active",
              endpoints: [],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    ) as typeof fetch;
    const svc = new AdaptersService();
    const out = await svc.findAll("ten-1");
    expect(out.adapters).toHaveLength(1);
    expect(out.adapters[0]?.id).toBe("a1");
  });

  it("findOneOrThrow throws when adapter missing", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("not found", { status: 404 })),
    ) as typeof fetch;
    const svc = new AdaptersService();
    await expect(svc.findOneOrThrow("ten-1", "missing")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("findOne returns null on 404", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("not found", { status: 404 })),
    ) as typeof fetch;
    const svc = new AdaptersService();
    const one = await svc.findOne("ten-1", "missing");
    expect(one).toBeNull();
  });

  it("adapterExists reflects findOne", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 404 })),
    ) as typeof fetch;
    const svc = new AdaptersService();
    const exists = await svc.adapterExists("ten-1", "x");
    expect(exists).toBe(false);
  });
});
