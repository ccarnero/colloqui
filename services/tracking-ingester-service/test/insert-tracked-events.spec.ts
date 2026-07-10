import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type InsertClient,
  insertTrackedEvents,
  toPgTextArrayLiteral,
} from "../src/lib/insert-tracked-events.js";
import {
  type TrackedEventRow,
  toTrackedEventRow,
} from "../src/lib/to-tracked-event-row.js";

const FIXTURES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "fixtures",
  "bus-events"
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

// A concrete, fully-populated canonical row used across unit tests. Built by
// hand (not via the mapper) so the unit tests assert the insert shape in
// isolation from T04.
function sampleRow(overrides: Partial<TrackedEventRow> = {}): TrackedEventRow {
  return {
    event_id: "evt-1",
    subject: "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    kind: "received",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: "cause-1",
    causation_depth: 2,
    occurred_at: "2026-07-09T12:00:00.000Z",
    tech: "whatsapp",
    business_fn: "messaging",
    rule: 3,
    consumed_by: ["usage-aggregator", "audit-service"],
    is_claim_check: false,
    envelope: { id: "evt-1", nested: { a: 1 } },
    compliance: "full",
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
    ...overrides,
  };
}

// A fake InsertClient that records the tagged-template SQL and the `.array`
// values in call order, and returns a caller-chosen server count.
function makeFakeClient(count = 1): {
  client: InsertClient;
  calls: { sql: string; arrays: readonly unknown[][] }[];
} {
  const calls: { sql: string; arrays: readonly unknown[][] }[] = [];
  const arrayBuffer: unknown[][] = [];

  const fn = ((
    template: TemplateStringsArray,
    ..._values: readonly unknown[]
  ): PromiseLike<{ count?: number }> => {
    // template.raw preserves the literal `::text[]` / `ON CONFLICT` text.
    calls.push({ sql: template.raw.join("?"), arrays: [...arrayBuffer] });
    arrayBuffer.length = 0;
    return Promise.resolve({ count });
  }) as InsertClient;

  fn.array = (values: readonly unknown[]): unknown => {
    const captured = [...values];
    arrayBuffer.push(captured);
    return captured;
  };

  return { client: fn, calls };
}

describe("toPgTextArrayLiteral", () => {
  it("encodes an empty list as {}", () => {
    expect(toPgTextArrayLiteral([])).toBe("{}");
  });

  it("quotes each element", () => {
    expect(toPgTextArrayLiteral(["a", "b"])).toBe('{"a","b"}');
  });

  it("escapes backslash and double-quote", () => {
    expect(toPgTextArrayLiteral(['a"b', "c\\d"])).toBe('{"a\\"b","c\\\\d"}');
  });
});

describe("insertTrackedEvents — empty batch short-circuit", () => {
  it("returns ok(inserted:0) without touching the client", async () => {
    const { client, calls } = makeFakeClient();
    const result = await insertTrackedEvents(client, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inserted).toBe(0);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("insertTrackedEvents — SQL shape", () => {
  it("emits ON CONFLICT (event_id) DO NOTHING", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [sampleRow()]);
    expect(calls).toHaveLength(1);
    const sql = calls[0]!.sql.replace(/\s+/g, " ").toLowerCase();
    expect(sql).toContain("on conflict (event_id) do nothing");
  });

  it("targets tracking.tracked_events", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [sampleRow()]);
    const sql = calls[0]!.sql.replace(/\s+/g, " ").toLowerCase();
    expect(sql).toContain("insert into tracking.tracked_events");
  });

  it("inserts exactly the 22 mapped columns in order (18 original + 4 T4 detail columns)", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [sampleRow()]);
    const sql = calls[0]!.sql;
    // The INSERT INTO (...) column list — first parenthesized block.
    const insertCols = sql
      .slice(sql.indexOf("("), sql.indexOf(")"))
      .replace(/[()]/g, "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    expect(insertCols).toEqual([
      "event_id",
      "subject",
      "tenant",
      "producer",
      "domain",
      "kind",
      "version",
      "correlation_id",
      "causation_id",
      "causation_depth",
      "occurred_at",
      "tech",
      "business_fn",
      "rule",
      "consumed_by",
      "is_claim_check",
      "envelope",
      "compliance",
      "workflow_id",
      "run_id",
      "connector_id",
      "cache_status",
    ]);
    // ingested_at is a DB default and must NOT be inserted.
    expect(insertCols).not.toContain("ingested_at");
  });

  it("casts jsonb, text[] and scalar UNNEST columns correctly", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [sampleRow()]);
    const sql = calls[0]!.sql.replace(/\s+/g, " ");
    // envelope is the last UNNEST arg, cast to jsonb[].
    expect(sql).toContain("::jsonb[]");
    // consumed_by is re-cast to text[] in the projection.
    expect(sql).toContain("consumed_by::text[]");
    // causation_depth and rule are integer[].
    expect(sql).toContain("::integer[]");
    // occurred_at is timestamptz[].
    expect(sql).toContain("::timestamptz[]");
    // is_claim_check is boolean[].
    expect(sql).toContain("::boolean[]");
  });

  it("passes 22 parallel arrays to the client (18 original + 4 T4 detail columns)", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [
      sampleRow(),
      sampleRow({ event_id: "evt-2" }),
    ]);
    expect(calls[0]!.arrays).toHaveLength(22);
    for (const arr of calls[0]!.arrays) {
      expect(arr).toHaveLength(2);
    }
  });
});

describe("insertTrackedEvents — value encoding", () => {
  it("serializes envelope to a JSON string and consumed_by to a PG array literal", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [sampleRow()]);
    const arrays = calls[0]!.arrays;
    // consumed_by is UNNEST arg index 14 (0-based).
    expect(arrays[14]).toEqual(['{"usage-aggregator","audit-service"}']);
    // envelope is UNNEST arg index 16.
    expect(arrays[16]).toEqual([
      JSON.stringify({ id: "evt-1", nested: { a: 1 } }),
    ]);
    // compliance is UNNEST arg index 17 (the 18th, last column).
    expect(arrays[17]).toEqual(["full"]);
  });

  it("carries the compliance verdict verbatim (partial)", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [sampleRow({ compliance: "partial" })]);
    expect(calls[0]!.arrays[17]).toEqual(["partial"]);
  });

  it("carries the T4 click-through detail columns at indices 18-21", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [
      sampleRow({
        workflow_id: "wf-1",
        run_id: "run-1",
        connector_id: "adapter-x",
        cache_status: "hit",
      }),
    ]);
    const arrays = calls[0]!.arrays;
    expect(arrays[18]).toEqual(["wf-1"]);
    expect(arrays[19]).toEqual(["run-1"]);
    expect(arrays[20]).toEqual(["adapter-x"]);
    expect(arrays[21]).toEqual(["hit"]);
  });

  it("defaults the T4 detail columns to null when absent", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [sampleRow()]);
    const arrays = calls[0]!.arrays;
    expect(arrays[18]).toEqual([null]);
    expect(arrays[19]).toEqual([null]);
    expect(arrays[20]).toEqual([null]);
    expect(arrays[21]).toEqual([null]);
  });

  it("carries nulls verbatim for nullable columns", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [
      sampleRow({
        tenant: null,
        kind: null,
        version: null,
        correlation_id: null,
        causation_id: null,
        causation_depth: null,
      }),
    ]);
    const arrays = calls[0]!.arrays;
    // Indices per UNNEST order: tenant=2, kind=5, version=6,
    // correlation_id=7, causation_id=8, causation_depth=9.
    expect(arrays[2]).toEqual([null]);
    expect(arrays[5]).toEqual([null]);
    expect(arrays[6]).toEqual([null]);
    expect(arrays[7]).toEqual([null]);
    expect(arrays[8]).toEqual([null]);
    expect(arrays[9]).toEqual([null]);
  });

  it("empty consumed_by becomes the empty-array literal {}", async () => {
    const { client, calls } = makeFakeClient();
    await insertTrackedEvents(client, [sampleRow({ consumed_by: [] })]);
    expect(calls[0]!.arrays[14]).toEqual(["{}"]);
  });
});

describe("insertTrackedEvents — failure handling", () => {
  it("returns a structured err when the client throws", async () => {
    const client = ((): PromiseLike<{ count?: number }> => {
      throw new Error("connection refused");
    }) as InsertClient;
    client.array = (v: readonly unknown[]): unknown => [...v];

    const result = await insertTrackedEvents(client, [sampleRow()]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toContain("connection refused");
    }
  });

  it("reports the server count as inserted", async () => {
    const { client } = makeFakeClient(1);
    const result = await insertTrackedEvents(client, [
      sampleRow(),
      sampleRow({ event_id: "evt-2" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inserted).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: real dev Postgres. SKIPS cleanly (with a logged reason) when
// neither POSTGRES_URL nor DATABASE_URL is set, so `bun test` stays green in
// CI without a cluster. When env IS set it runs for real: inserting the same
// event twice must leave exactly one row (ON CONFLICT idempotency).
// ---------------------------------------------------------------------------
const DSN =
  process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();

describe("insertTrackedEvents — dev Postgres integration", () => {
  if (!DSN) {
    it("SKIPPED — set POSTGRES_URL or DATABASE_URL to run against dev Postgres", () => {
      // eslint-disable-next-line no-console
      console.log(
        "[insert-tracked-events.spec] integration SKIPPED: neither POSTGRES_URL nor DATABASE_URL is set"
      );
      expect(DSN).toBeUndefined();
    });
    return;
  }

  it("inserting the same event twice yields exactly one row", async () => {
    const { default: postgres } = await import("postgres");
    const { applySchema } = await import("../src/lib/apply-schema.js");
    const { loadSchemaStatements } = await import(
      "../src/lib/load-schema-statements.js"
    );

    const sql = postgres(DSN, { max: 1, prepare: false });
    // Dedicated event_id namespace so the test never collides with real data
    // and can clean up exactly what it wrote.
    const eventId = `test:insert-tracked-events:${Date.now()}`;

    try {
      const ddlPath = join(
        import.meta.dir,
        "..",
        "src",
        "sql",
        "tracked-events.sql"
      );
      const statements = loadSchemaStatements(readFileSync(ddlPath, "utf8"));
      const applied = await applySchema(sql, statements);
      expect(applied.ok).toBe(true);

      // Build a real row through the mapper from a live fixture, then override
      // the event_id into the test namespace.
      const envelope = loadFixture(
        "audit-service-channel-envelope-01.json"
      ) as { id: string };
      const mapped = toTrackedEventRow(
        "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1",
        envelope
      );
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) {
        throw new Error("fixture did not map to a row");
      }
      const row: TrackedEventRow = { ...mapped.value, event_id: eventId };

      await sql`DELETE FROM tracking.tracked_events WHERE event_id = ${eventId}`;

      const first = await insertTrackedEvents(sql, [row]);
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.value.inserted).toBe(1);
      }

      const second = await insertTrackedEvents(sql, [row]);
      expect(second.ok).toBe(true);
      if (second.ok) {
        // ON CONFLICT DO NOTHING → zero rows inserted the second time.
        expect(second.value.inserted).toBe(0);
      }

      const rows = await sql<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM tracking.tracked_events WHERE event_id = ${eventId}`;
      expect(rows[0]!.n).toBe(1);
    } finally {
      await sql`DELETE FROM tracking.tracked_events WHERE event_id = ${eventId}`;
      await sql.end({ timeout: 5 });
    }
  });
});
