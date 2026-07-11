import { describe, expect, it } from "bun:test";
import type { PayloadRow } from "../../src/lib/build-payload-query.js";
import { handlePayloadRequest } from "../../src/lib/handle-payload-request.js";

function rowFor(
  payload_status: PayloadRow["payload_status"],
  payload: unknown = { hello: "world" }
): PayloadRow {
  return { payload_status, payload };
}

describe("handlePayloadRequest", () => {
  it("returns 400 when tenant is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handlePayloadRequest("corr-1", "evt-1", null, {
      queryPayload: async () => {
        called = true;
        return [];
      },
    });

    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 for a blank tenant header", async () => {
    const result = await handlePayloadRequest("corr-1", "evt-1", "  ", {
      queryPayload: async () => [],
    });
    expect(result.status).toBe(400);
  });

  it("returns 404 for an unknown event (zero rows)", async () => {
    const result = await handlePayloadRequest("corr-1", "evt-1", "tenant-a", {
      queryPayload: async () => [],
    });
    expect(result.status).toBe(404);
    if (result.status === 404) {
      expect(result.body.error).toContain("no event found");
    }
  });

  it("returns 410 Gone when payload_status is scrubbed", async () => {
    const result = await handlePayloadRequest("corr-1", "evt-1", "tenant-a", {
      queryPayload: async () => [rowFor("scrubbed", null)],
    });
    expect(result.status).toBe(410);
    if (result.status === 410) {
      expect(result.body.error).toContain("scrubbed");
    }
  });

  it("returns 404 with a 'never captured' reason when payload_status is none", async () => {
    const result = await handlePayloadRequest("corr-1", "evt-1", "tenant-a", {
      queryPayload: async () => [rowFor("none", null)],
    });
    expect(result.status).toBe(404);
    if (result.status === 404) {
      expect(result.body.error).toContain("never captured");
      expect(result.body.error).toContain("payload_status=none");
    }
  });

  it("returns 404 with an 'unresolved' reason when payload_status is unresolved", async () => {
    const result = await handlePayloadRequest("corr-1", "evt-1", "tenant-a", {
      queryPayload: async () => [rowFor("unresolved", null)],
    });
    expect(result.status).toBe(404);
    if (result.status === 404) {
      expect(result.body.error).toContain("failed to resolve");
      expect(result.body.error).toContain("payload_status=unresolved");
    }
  });

  it("distinguishes the none vs unresolved 404 reasons", async () => {
    const none = await handlePayloadRequest("corr-1", "evt-1", "tenant-a", {
      queryPayload: async () => [rowFor("none", null)],
    });
    const unresolved = await handlePayloadRequest(
      "corr-1",
      "evt-1",
      "tenant-a",
      {
        queryPayload: async () => [rowFor("unresolved", null)],
      }
    );
    expect(none.status).toBe(404);
    expect(unresolved.status).toBe(404);
    if (none.status === 404 && unresolved.status === 404) {
      expect(none.body.error).not.toBe(unresolved.body.error);
    }
  });

  it("returns 200 with payload + payload_status for an inline payload", async () => {
    const result = await handlePayloadRequest("corr-1", "evt-1", "tenant-a", {
      queryPayload: async (query) => {
        expect(query.params).toEqual(["corr-1", "evt-1", "tenant-a"]);
        return [rowFor("inline", { foo: "bar" })];
      },
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.payload).toEqual({ foo: "bar" });
      expect(result.body.payload_status).toBe("inline");
    }
  });

  it("returns 200 for a resolved (claim-check) payload", async () => {
    const result = await handlePayloadRequest("corr-1", "evt-1", "tenant-a", {
      queryPayload: async () => [rowFor("resolved", { big: "payload" })],
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.payload_status).toBe("resolved");
    }
  });
});
