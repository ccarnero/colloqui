import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventEnvelope } from "@yoizen/shared";
import { isClaimCheck } from "../src/lib/is-claim-check.js";

// Repo root is three levels up from services/tracking-ingester-service/test.
const GOLDEN_ROOT = join(import.meta.dir, "..", "..", "..", "golden");
const GOLDEN_TSV = join(GOLDEN_ROOT, "labeled.tsv");
const GOLDEN_RAW = join(GOLDEN_ROOT, "raw");

function value(envelope: EventEnvelope): boolean {
  const r = isClaimCheck(envelope);
  if (!r.ok) {
    throw new Error(`unexpected err: ${r.error}`);
  }
  return r.value;
}

// Minimal canonical envelope with an explicit data block, for unit assertions.
function envelopeWith(
  dataOverrides: Partial<EventEnvelope["data"]>
): EventEnvelope {
  return {
    data: {
      received_at: "2026-07-09T21:05:52.100Z",
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "",
      payload: null,
      ...dataOverrides,
    },
  } as EventEnvelope;
}

describe("isClaimCheck — TAXONOMY.md §6 facet", () => {
  it("rejects a non-object input", () => {
    // @ts-expect-error — exercising the runtime guard for invalid input.
    expect(isClaimCheck(null).ok).toBe(false);
    // @ts-expect-error — exercising the runtime guard for invalid input.
    expect(isClaimCheck("nope").ok).toBe(false);
  });

  it("payload_inline === false → true (slim claim-check envelope)", () => {
    expect(
      value(
        envelopeWith({
          payload_inline: false,
          payload_ref: "PAYLOAD-acme/abc",
          payload: null,
        })
      )
    ).toBe(true);
  });

  it("payload_inline === true → false (inline payload)", () => {
    expect(value(envelopeWith({ payload_inline: true }))).toBe(false);
  });

  it("missing data block → false (non-canonical envelope, not a claim check)", () => {
    expect(value({} as EventEnvelope)).toBe(false);
  });
});

// --- Golden gate: is_claim_check must match golden/labeled.tsv at 100%. ---
// labeled.tsv carries no envelope payloads, so the flag is recomputed from the
// real envelopes in golden/raw/ (each row's `file` column names the wrapper
// JSON; the envelope lives under its `.envelope` key). See golden/README.md.

interface GoldenRow {
  file: string;
  seq: string;
  isClaimCheck: boolean;
}

function loadGolden(): GoldenRow[] {
  const raw = readFileSync(GOLDEN_TSV, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const [header, ...dataLines] = lines;
  const cols = header.split("\t");
  const idx = {
    file: cols.indexOf("file"),
    seq: cols.indexOf("seq"),
    isClaimCheck: cols.indexOf("is_claim_check"),
  };
  return dataLines.map((line) => {
    const c = line.split("\t");
    return {
      file: c[idx.file],
      seq: c[idx.seq],
      isClaimCheck: c[idx.isClaimCheck] === "true",
    };
  });
}

function loadEnvelope(file: string): EventEnvelope {
  const raw = readFileSync(join(GOLDEN_RAW, file), "utf8");
  const wrapper = JSON.parse(raw) as { envelope: EventEnvelope };
  return wrapper.envelope;
}

describe("isClaimCheck — golden gate (golden/labeled.tsv)", () => {
  const rows = loadGolden();

  it("labels every raw envelope present under golden/raw/", () => {
    const rawFiles = readdirSync(GOLDEN_RAW).filter((f) => f.endsWith(".json"));
    expect(rows.length).toBe(rawFiles.length);
  });

  it("matches the is_claim_check column at 100%", () => {
    const misses: string[] = [];
    for (const row of rows) {
      const envelope = loadEnvelope(row.file);
      const r = isClaimCheck(envelope);
      if (!r.ok) {
        misses.push(`seq ${row.seq}: classifier error ${r.error}`);
        continue;
      }
      if (r.value !== row.isClaimCheck) {
        misses.push(
          `seq ${row.seq} [${row.file}] expected is_claim_check=${row.isClaimCheck} got ${r.value}`
        );
      }
    }
    if (misses.length > 0) {
      console.error(
        `is_claim_check misses (${misses.length}):\n` + misses.join("\n")
      );
    }
    expect(misses.length).toBe(0);
  });
});
