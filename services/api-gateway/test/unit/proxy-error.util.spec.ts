import { describe, it, expect } from "bun:test";
import { HttpException } from "@nestjs/common";
import { throwProxyError } from "../../src/utils/proxy-error.util";

describe("throwProxyError", () => {
  it("throws HttpException with parsed JSON body and status", async () => {
    const res = new Response(JSON.stringify({ code: "E_DOWNSTREAM" }), {
      status: 502,
    });
    const logger = { error: () => {} };

    try {
      await throwProxyError(res, "downstream", logger);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(502);
      expect(ex.getResponse()).toEqual({ code: "E_DOWNSTREAM" });
      return;
    }
    expect.unreachable();
  });

  it("wraps non-JSON body in message field", async () => {
    const res = new Response("plain-text-error", { status: 500 });
    const logger = { error: () => {} };

    try {
      await throwProxyError(res, "svc", logger);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getResponse()).toEqual({
        message: "plain-text-error",
      });
      return;
    }
    expect.unreachable();
  });
});
