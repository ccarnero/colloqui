import { describe, expect, test } from "bun:test";
import {
  fetchAssociatedIds,
  type InvokeCapableClient,
} from "../src/hubspot-associations.js";

function clientReturning(status: number, data: unknown): InvokeCapableClient {
  return {
    connectors: {
      invoke: async () => ({
        invocationId: "inv-1",
        status,
        data,
        headers: {},
        cacheResult: "miss",
      }),
    },
  };
}

function clientThrowing(error: Error): InvokeCapableClient {
  return {
    connectors: {
      invoke: async () => {
        throw error;
      },
    },
  };
}

describe("fetchAssociatedIds", () => {
  test("parses HubSpot v3 associations batch/read ids on HTTP 200", async () => {
    const client = clientReturning(200, {
      results: [
        {
          from: { id: "contact-1" },
          to: [{ id: "deal-1" }, { id: "deal-2" }],
        },
      ],
    });

    const result = await fetchAssociatedIds(
      client,
      "connector-1",
      "endpoint-1",
      "contact-1"
    );

    expect(result).toEqual({ ok: true, ids: ["deal-1", "deal-2"] });
  });

  test("falls back to toObjectId when id is absent", async () => {
    const client = clientReturning(200, {
      results: [{ from: { id: "contact-1" }, to: [{ toObjectId: "deal-9" }] }],
    });

    const result = await fetchAssociatedIds(
      client,
      "connector-1",
      "endpoint-1",
      "contact-1"
    );

    expect(result).toEqual({ ok: true, ids: ["deal-9"] });
  });

  test("no associations returns an empty, still-ok result", async () => {
    const client = clientReturning(200, { results: [] });

    const result = await fetchAssociatedIds(
      client,
      "connector-1",
      "endpoint-1",
      "contact-1"
    );

    expect(result).toEqual({ ok: true, ids: [] });
  });

  test("HTTP 207 (no associations for the input) is ok with empty ids, not crm-unavailable", async () => {
    const client = clientReturning(207, {
      results: [],
      numErrors: 1,
      errors: [
        {
          status: "error",
          category: "OBJECT_NOT_FOUND",
          message:
            "No contact_to_ticket association found for contact contact-1",
        },
      ],
    });

    const result = await fetchAssociatedIds(
      client,
      "connector-1",
      "endpoint-1",
      "contact-1"
    );

    expect(result).toEqual({ ok: true, ids: [] });
  });

  test("HTTP 207 with partial results still extracts the matched ids", async () => {
    const client = clientReturning(207, {
      results: [{ from: { id: "contact-1" }, to: [{ id: "deal-1" }] }],
      numErrors: 1,
      errors: [{ status: "error", category: "OBJECT_NOT_FOUND" }],
    });

    const result = await fetchAssociatedIds(
      client,
      "connector-1",
      "endpoint-1",
      "contact-1"
    );

    expect(result).toEqual({ ok: true, ids: ["deal-1"] });
  });

  test("non-200 downstream status degrades instead of throwing", async () => {
    const client = clientReturning(500, { message: "internal error" });

    const result = await fetchAssociatedIds(
      client,
      "connector-1",
      "endpoint-1",
      "contact-1"
    );

    expect(result.ok).toBe(false);
    expect(result.ids).toEqual([]);
    expect(result.error).toBe("hubspot-http-500");
  });

  test("a thrown SdkError (e.g. circuit breaker open) degrades instead of propagating", async () => {
    const client = clientThrowing(new Error("circuit breaker open"));

    const result = await fetchAssociatedIds(
      client,
      "connector-1",
      "endpoint-1",
      "contact-1"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("circuit breaker open");
  });
});
