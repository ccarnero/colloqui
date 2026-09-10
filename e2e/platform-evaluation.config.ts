import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const runId = process.env.E2E_EVAL_RUN_ID?.trim() || randomUUID();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
  throw new Error("E2E_EVAL_RUN_ID must be a UUID");
}
process.env.E2E_EVAL_RUN_ID = runId;
const evidenceRoot = path.resolve("manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright");
const evidenceDir = path.resolve(evidenceRoot, runId);
if (path.dirname(evidenceDir) !== evidenceRoot) throw new Error("Playwright evidence path escaped its allowed root");
if (process.env.TEST_WORKER_INDEX === undefined && existsSync(evidenceDir)) throw new Error("Playwright evidence directory already exists for this run ID");

export default defineConfig({
  testDir: ".",
  testMatch: "platform-evaluation.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  outputDir: path.join(evidenceDir, "artifacts"),
  preserveOutput: "always",
  reporter: [["line"]],
  use: {
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
