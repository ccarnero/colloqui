import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "../src/lib/classify.js";

// Repo root is three levels up from services/tracking-ingester-service/test.
const GOLDEN_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "golden",
  "labeled.tsv"
);

interface GoldenRow {
  seq: string;
  subject: string;
  tech: string;
  businessFn: string;
  rule: number;
}

function loadGolden(): GoldenRow[] {
  const raw = readFileSync(GOLDEN_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const [header, ...dataLines] = lines;
  const cols = header.split("\t");
  const idx = {
    seq: cols.indexOf("seq"),
    subject: cols.indexOf("subject"),
    tech: cols.indexOf("tech"),
    businessFn: cols.indexOf("business_fn"),
    rule: cols.indexOf("rule"),
  };
  return dataLines.map((line) => {
    const c = line.split("\t");
    return {
      seq: c[idx.seq],
      subject: c[idx.subject],
      tech: c[idx.tech],
      businessFn: c[idx.businessFn],
      rule: Number(c[idx.rule]),
    };
  });
}

describe("classify — golden gate (golden/labeled.tsv)", () => {
  const rows = loadGolden();

  it("parses 72 labeled data rows", () => {
    expect(rows.length).toBe(72);
  });

  it("classifies (tech, business_fn, rule) with >= 0.90 accuracy", () => {
    let correct = 0;
    const misses: string[] = [];
    for (const row of rows) {
      const r = classify(row.subject);
      if (!r.ok) {
        misses.push(`seq ${row.seq}: classifier error ${r.error}`);
        continue;
      }
      const v = r.value;
      const techOk = v.tech === row.tech;
      const fnOk = v.businessFn === row.businessFn;
      const ruleOk = v.rule === row.rule;
      if (techOk && fnOk && ruleOk) {
        correct++;
      } else {
        misses.push(
          `seq ${row.seq} [${row.subject}] expected tech=${row.tech} fn=${row.businessFn} rule=${row.rule}` +
            ` got tech=${v.tech} fn=${v.businessFn} rule=${v.rule}`
        );
      }
    }
    const accuracy = correct / rows.length;
    if (accuracy < 0.9) {
      // Surface disagreements so the gate failure is actionable.
      console.error(`golden misses (${misses.length}):\n` + misses.join("\n"));
    }
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });
});
