import { describe, expect, it } from "bun:test";
import { buildScrubBatchQuery } from "../src/lib/build-scrub-batch-query.js";
import { buildScrubCandidateCountQuery } from "../src/lib/build-scrub-candidate-count-query.js";
import { computeScrubCutoff } from "../src/lib/compute-scrub-cutoff.js";
import { resolveApplyFlag } from "../src/lib/resolve-apply-flag.js";
import {
  DEFAULT_PAYLOAD_RETENTION_DAYS,
  resolveRetentionDays,
} from "../src/lib/resolve-retention-days.js";
import {
  DEFAULT_SCRUB_BATCH_SIZE,
  scrubPayloads,
} from "../src/lib/scrub-payloads.js";

describe("computeScrubCutoff", () => {
  it("subtracts retentionDays days from now", () => {
    const now = new Date("2026-07-11T00:00:00.000Z");
    const cutoff = computeScrubCutoff(now, 30);
    expect(cutoff.toISOString()).toBe("2026-06-11T00:00:00.000Z");
  });

  it("supports a non-default retention window", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const cutoff = computeScrubCutoff(now, 7);
    expect(cutoff.toISOString()).toBe("2026-01-03T12:00:00.000Z");
  });

  it("a zero-day retention window yields a cutoff equal to now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(computeScrubCutoff(now, 0).getTime()).toBe(now.getTime());
  });
});

describe("resolveRetentionDays", () => {
  it("defaults to 30 when PAYLOAD_RETENTION_DAYS is unset", () => {
    expect(resolveRetentionDays({})).toBe(DEFAULT_PAYLOAD_RETENTION_DAYS);
    expect(DEFAULT_PAYLOAD_RETENTION_DAYS).toBe(30);
  });

  it("parses a valid positive integer override", () => {
    expect(resolveRetentionDays({ PAYLOAD_RETENTION_DAYS: "14" })).toBe(14);
  });

  it("falls back to the default on a non-numeric value", () => {
    expect(resolveRetentionDays({ PAYLOAD_RETENTION_DAYS: "abc" })).toBe(30);
  });

  it("falls back to the default on a zero/negative value", () => {
    expect(resolveRetentionDays({ PAYLOAD_RETENTION_DAYS: "0" })).toBe(30);
    expect(resolveRetentionDays({ PAYLOAD_RETENTION_DAYS: "-5" })).toBe(30);
  });

  it("falls back to the default on an empty/whitespace value", () => {
    expect(resolveRetentionDays({ PAYLOAD_RETENTION_DAYS: "  " })).toBe(30);
  });
});

describe("resolveApplyFlag", () => {
  it("defaults to dry-run (false) with no flags", () => {
    expect(resolveApplyFlag(["bun", "scrub-payloads.ts"])).toBe(false);
  });

  it("returns true only when --apply is present", () => {
    expect(resolveApplyFlag(["bun", "scrub-payloads.ts", "--apply"])).toBe(
      true
    );
  });

  it("ignores unrelated flags", () => {
    expect(
      resolveApplyFlag(["bun", "scrub-payloads.ts", "--verbose", "--dry"])
    ).toBe(false);
  });
});

describe("buildScrubBatchQuery", () => {
  it("parametrizes the cutoff (ISO string) and batch size", () => {
    const cutoff = new Date("2026-06-11T00:00:00.000Z");
    const query = buildScrubBatchQuery(cutoff, 5000);
    expect(query.params).toEqual([cutoff.toISOString(), 5000]);
  });

  it("scopes the WHERE clause to occurred_at < cutoff AND payload_status IN (inline, resolved)", () => {
    const query = buildScrubBatchQuery(new Date(), 100);
    expect(query.text).toMatch(/occurred_at\s*<\s*\$1/);
    expect(query.text).toMatch(
      /payload_status\s+IN\s*\(\s*'inline',\s*'resolved'\s*\)/i
    );
    expect(query.text).toMatch(/LIMIT\s*\$2/i);
  });

  it("empties envelope.data.payload and flips payload_status to scrubbed with a timestamp", () => {
    const query = buildScrubBatchQuery(new Date(), 100);
    expect(query.text).toMatch(
      /jsonb_set\(\s*t\.envelope,\s*'\{data,payload\}',\s*'null'::jsonb\s*\)/
    );
    expect(query.text).toMatch(/payload_status\s*=\s*'scrubbed'/);
    expect(query.text).toMatch(/payload_scrubbed_at\s*=\s*now\(\)/);
  });

  it("uses FOR UPDATE SKIP LOCKED so concurrent runs never double-scrub", () => {
    const query = buildScrubBatchQuery(new Date(), 100);
    expect(query.text).toMatch(/FOR UPDATE SKIP LOCKED/i);
  });
});

describe("buildScrubCandidateCountQuery", () => {
  it("parametrizes the cutoff and groups by tenant", () => {
    const cutoff = new Date("2026-06-11T00:00:00.000Z");
    const query = buildScrubCandidateCountQuery(cutoff);
    expect(query.params).toEqual([cutoff.toISOString()]);
    expect(query.text).toMatch(/GROUP BY tenant/i);
    expect(query.text).toMatch(
      /payload_status\s+IN\s*\(\s*'inline',\s*'resolved'\s*\)/i
    );
  });
});

describe("scrubPayloads", () => {
  it("loops in batches until a batch affects zero rows", async () => {
    // Simulates 12000 eligible rows scrubbed at 5000/batch: 5000, 5000, 2000, 0.
    const remainingByBatch = [5000, 5000, 2000, 0];
    let call = 0;
    const seenBatchSizes: number[] = [];

    const result = await scrubPayloads(new Date(), 5000, {
      runBatch: async (query) => {
        seenBatchSizes.push(query.params[1]);
        const affected = remainingByBatch[call]!;
        call++;
        return affected;
      },
    });

    expect(result.totalScrubbed).toBe(12000);
    expect(result.batches).toBe(4);
    expect(call).toBe(4);
    expect(seenBatchSizes).toEqual([5000, 5000, 5000, 5000]);
  });

  it("stops after a single batch when nothing is eligible", async () => {
    let calls = 0;
    const result = await scrubPayloads(new Date(), 5000, {
      runBatch: async () => {
        calls++;
        return 0;
      },
    });

    expect(result.totalScrubbed).toBe(0);
    expect(result.batches).toBe(1);
    expect(calls).toBe(1);
  });

  it("defaults batchSize to DEFAULT_SCRUB_BATCH_SIZE (5000) when not supplied", async () => {
    let seenBatchSize: number | undefined;
    await scrubPayloads(new Date(), undefined as unknown as number, {
      runBatch: async (query) => {
        seenBatchSize = query.params[1];
        return 0;
      },
    });
    expect(seenBatchSize).toBe(DEFAULT_SCRUB_BATCH_SIZE);
    expect(DEFAULT_SCRUB_BATCH_SIZE).toBe(5000);
  });

  it("is idempotent: re-running against the same cutoff after a full scrub affects 0 rows", async () => {
    // First pass scrubs one batch of 3 eligible rows, then a terminal
    // zero-affected batch (matching the real predicate: once every eligible
    // row is flipped to 'scrubbed' it can never match again within the SAME
    // run either). Second pass (fresh call) simulates the post-scrub state
    // where the predicate no longer matches anything from the start.
    let firstPassCalls = 0;
    const first = await scrubPayloads(new Date(), 5000, {
      runBatch: async () => {
        firstPassCalls++;
        return firstPassCalls === 1 ? 3 : 0;
      },
    });
    expect(first.totalScrubbed).toBe(3);
    expect(first.batches).toBe(2);

    let secondPassCalls = 0;
    const second = await scrubPayloads(new Date(), 5000, {
      runBatch: async () => {
        secondPassCalls++;
        return 0;
      },
    });
    expect(second.totalScrubbed).toBe(0);
    expect(second.batches).toBe(1);
    expect(secondPassCalls).toBe(1);
  });

  it("logs verbose progress per batch when a logger is supplied", async () => {
    const lines: string[] = [];
    await scrubPayloads(new Date(), 5000, {
      runBatch: async () => 0,
      log: (message) => lines.push(message),
    });
    expect(lines.some((l) => l.includes("starting"))).toBe(true);
    expect(lines.some((l) => l.includes("batch 1"))).toBe(true);
    expect(lines.some((l) => l.includes("complete"))).toBe(true);
  });
});
