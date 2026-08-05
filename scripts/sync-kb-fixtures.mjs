#!/usr/bin/env node
/**
 * sync-kb-fixtures.mjs — make the `.md` fixture the single source of truth for
 * a knowledge-base document that a sample manifest embeds inline.
 *
 * WHY THIS EXISTS
 * Two integration samples ship a knowledge-base document twice: once as a real
 * `.md` file a human can read and edit, and once as a `content: |` literal
 * block inside the sample's `manifest.yaml` (the manifest schema in
 * `packages/shared/src/provisioning/manifest.schema.ts` supports ONLY
 * `type: "inline"` for KB document sources today — there is no `type: "file"`).
 * They were hand-synced, and they drifted: the docs-truth-audit T06 found
 * `acme-telco-policy.md` at 3420 bytes against the manifest's 3450.
 *
 * The T09 ruling (D29) chose a generator over a detector: instead of a guard
 * that notices drift after the fact, this script REGENERATES the manifest's
 * inline block from the `.md`, so the two cannot diverge. Edit the `.md`, run
 * this, commit both.
 *
 * USAGE
 *   scripts/sync-kb-fixtures.mjs            # rewrite the manifests from the .md files
 *   scripts/sync-kb-fixtures.mjs --check    # exit 1 if any manifest is out of sync
 *
 * `--check` prints the exact byte counts of both sides for every pair, so a
 * failure names the drift rather than just asserting it.
 *
 * SCOPE — the two pairs below. Adding a third is one entry in PAIRS. Each entry
 * names the document by its manifest `- name:` slug, so a manifest carrying
 * several documents still syncs only the one this fixture owns.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ fixture: string; manifest: string; documentName: string }[]} */
const PAIRS = [
  {
    fixture: "integrations/ai/ai-skill-support-agent/policy/acme-telco-policy.md",
    manifest: "integrations/ai/ai-skill-support-agent/manifest.yaml",
    documentName: "acme-telco-policy",
  },
  {
    fixture: "integrations/ai/ai-knowledge-base-agent/docs/support-faq.md",
    manifest: "integrations/ai/ai-knowledge-base-agent/manifest.yaml",
    documentName: "support-faq",
  },
];

const CHECK = process.argv.includes("--check");

/**
 * Locate the `content: |` literal block belonging to `- name: <documentName>`
 * and return its line range plus the indentation the block body uses.
 *
 * The search is deliberately structural rather than regex-over-the-whole-file:
 * it walks from the document's `- name:` line to the first `content: |` at a
 * deeper indent, then consumes every following line that is blank or indented
 * deeper than the `content:` key. That is exactly YAML's literal-block rule,
 * and it stops cleanly at the next key or the next list item.
 */
function locateBlock(lines, documentName) {
  const nameRe = new RegExp(`^(\\s*)-\\s+name:\\s+${documentName}\\s*$`);
  const nameIdx = lines.findIndex((l) => nameRe.test(l));
  if (nameIdx === -1) {
    throw new Error(`document '- name: ${documentName}' not found`);
  }
  const nameIndent = lines[nameIdx].match(nameRe)[1].length;

  let contentIdx = -1;
  for (let i = nameIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    // A line at or left of the `- name:` indent ends this document entry.
    if (indent <= nameIndent) break;
    if (/^\s*content:\s*\|\s*$/.test(line)) {
      contentIdx = i;
      break;
    }
  }
  if (contentIdx === -1) {
    throw new Error(`no 'content: |' block under '- name: ${documentName}'`);
  }

  const keyIndent = lines[contentIdx].length - lines[contentIdx].trimStart().length;
  let end = contentIdx + 1;
  let bodyIndent = null;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") {
      end++;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= keyIndent) break;
    if (bodyIndent === null) bodyIndent = indent;
    end++;
  }
  // Trailing blank lines belong to whatever follows, not to the block.
  while (end > contentIdx + 1 && lines[end - 1].trim() === "") end--;
  if (bodyIndent === null) {
    throw new Error(`'content: |' block for '${documentName}' is empty`);
  }
  return { start: contentIdx + 1, end, bodyIndent };
}

/** Render fixture text as a YAML literal-block body at the given indent. */
function renderBlock(text, indent) {
  const pad = " ".repeat(indent);
  return text
    .replace(/\n+$/, "")
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l));
}

let failures = 0;
let rewritten = 0;

for (const pair of PAIRS) {
  const fixturePath = resolve(ROOT, pair.fixture);
  const manifestPath = resolve(ROOT, pair.manifest);
  const fixture = readFileSync(fixturePath, "utf8");
  const manifest = readFileSync(manifestPath, "utf8");
  const lines = manifest.split("\n");

  let block;
  try {
    block = locateBlock(lines, pair.documentName);
  } catch (err) {
    console.error(`[FAIL] ${pair.manifest}: ${err.message}`);
    failures++;
    continue;
  }

  const current = lines.slice(block.start, block.end);
  const desired = renderBlock(fixture, block.bodyIndent);
  const inSync = current.length === desired.length && current.every((l, i) => l === desired[i]);

  const currentBytes = Buffer.byteLength(
    current.map((l) => l.slice(block.bodyIndent)).join("\n") + "\n",
    "utf8"
  );
  const fixtureBytes = Buffer.byteLength(fixture, "utf8");

  if (inSync) {
    console.log(
      `[OK]   ${pair.documentName}: ${pair.fixture} (${fixtureBytes} bytes) == ${pair.manifest} inline block (${currentBytes} bytes)`
    );
    continue;
  }

  if (CHECK) {
    console.error(
      `[FAIL] ${pair.documentName}: ${pair.fixture} (${fixtureBytes} bytes) != ${pair.manifest} inline block (${currentBytes} bytes) — run scripts/sync-kb-fixtures.mjs`
    );
    failures++;
    continue;
  }

  const next = [...lines.slice(0, block.start), ...desired, ...lines.slice(block.end)];
  writeFileSync(manifestPath, next.join("\n"), "utf8");
  rewritten++;
  console.log(
    `[SYNC] ${pair.documentName}: rewrote ${pair.manifest} inline block from ${pair.fixture} (${fixtureBytes} bytes)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} knowledge-base fixture pair(s) out of sync.`);
  process.exit(1);
}
console.log(
  CHECK
    ? `\nAll ${PAIRS.length} knowledge-base fixture pairs are in sync.`
    : `\n${rewritten} manifest(s) rewritten; ${PAIRS.length - rewritten} already in sync.`
);
