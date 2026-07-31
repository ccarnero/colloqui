import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as shared from "../index";
import { getTenantStreamName } from "../tenant-stream.constants";

/**
 * ONE ingress stream-name builder (envelope-drift T07, SPEC decision 3 —
 * human-approved).
 *
 * `@yoizen/shared` used to export TWO builders for the same name:
 *
 *   getTenantStreamName(t)  -> `INGRESS-${t.toUpperCase()}`  (canonical)
 *   the removed builder     -> `INGRESS-${t}`                (verbatim)
 *
 * They disagree for any tenant id that is not already upper-case: for tenant
 * `acme` the removed builder produced `INGRESS-acme`, a stream that does not
 * exist — every live stream is upper-cased (`INGRESS-ACME`, verified
 * in-cluster). Two builders for one name is the drift; the lower-casing one is
 * also the wrong one, so it was deleted rather than aliased. Its name is
 * assembled (never written out) below: T07's accept gate greps `packages/` for
 * that identifier and requires zero hits, so spelling it here would
 * re-introduce the very symbol this task removed. See
 * `DOCS/architecture/multi-tenancy.md` §6.3 for the removal note.
 *
 * This pin fails if anyone re-adds a second builder.
 */

/**
 * Every form this repo could plausibly use to BUILD an `INGRESS-` name:
 *
 *   1. `` `INGRESS-${...}` ``            — literal template (what the removed
 *                                          builder and `getTenantStreamName` use)
 *   2. `` `${CHANNEL_STREAM_PREFIX}-` `` — the HOUSE pattern. `channel.constants.ts:1`
 *                                          exports `CHANNEL_STREAM_PREFIX = "INGRESS"`,
 *                                          and `buildDlqStreamName` is written exactly
 *                                          this way, so a re-added builder would most
 *                                          naturally look like this and would evade a
 *                                          literal-only scan.
 *   3. `"INGRESS-" + t`                  — plain concatenation.
 *
 * A static scan is used on purpose: probing exports by calling them would
 * execute unrelated functions (`reportMcpUsageEvent` attempts an HTTP request,
 * for one), and scanning catches a differently-NAMED copy just as well — it
 * keys off construction, not off a naming convention.
 *
 * Returns `file:symbol` pairs; comments and doc prose are ignored.
 */
function ingressNameConstructors(): string[] {
  const srcDir = join(import.meta.dir, "..");
  const found: string[] = [];

  for (const file of readdirSync(srcDir, { recursive: true }) as string[]) {
    if (!file.endsWith(".ts") || file.includes("__tests__")) {
      continue;
    }
    const lines = readFileSync(join(srcDir, file), "utf-8").split("\n");

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const isComment =
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*");
      if (isComment) {
        return;
      }
      // Only real construction counts; `INGRESS-<tenant>` in prose does not.
      const buildsIngressName =
        line.includes("`INGRESS-${") ||
        /CHANNEL_STREAM_PREFIX\s*}\s*-/.test(line) ||
        /CHANNEL_STREAM_PREFIX\s*\+\s*["'`]-/.test(line) ||
        /["'`]INGRESS-["'`]\s*\+/.test(line);
      if (!buildsIngressName) {
        return;
      }

      let symbol = "<module scope>";
      for (let i = index; i >= 0; i--) {
        const match = /^export (?:function|const) ([A-Za-z0-9_]+)/.exec(
          lines[i]!
        );
        if (match) {
          symbol = match[1]!;
          break;
        }
      }
      found.push(`${file}:${symbol}`);
    });
  }

  return found.sort();
}

describe("ingress stream-name builder (single source of truth)", () => {
  test("the shared package builds the ingress name in exactly ONE place", () => {
    expect(ingressNameConstructors()).toEqual([
      "tenant-stream.constants.ts:getTenantStreamName",
    ]);
  });

  test("the canonical builder upper-cases the tenant id", () => {
    // packages/shared/src/tenant-stream.constants.ts:44-45
    expect(getTenantStreamName("acme")).toBe("INGRESS-ACME");
    expect(getTenantStreamName("ACME")).toBe("INGRESS-ACME");
    expect(getTenantStreamName("Acme-Corp")).toBe("INGRESS-ACME-CORP");
  });

  test("the removed verbatim builder is gone from the public surface", () => {
    // Assembled, never written out — see the file header for why.
    const removedBuilder = ["build", "Ingress", "Stream", "Name"].join("");
    expect(removedBuilder in shared).toBe(false);
    expect((shared as Record<string, unknown>)[removedBuilder]).toBeUndefined();
  });

  test("the surviving builder never yields the lower-cased (non-existent) name", () => {
    // `INGRESS-acme` is what the removed builder produced for tenant `acme`;
    // no such stream exists in any cluster.
    expect(getTenantStreamName("acme")).not.toBe("INGRESS-acme");
    expect(getTenantStreamName("acme")).toBe("INGRESS-ACME");
  });
});
