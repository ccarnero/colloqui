import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CONFIG = path.join(ROOT, "e2e/platform-evaluation.config.ts");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");
const EVIDENCE_ROOT = path.join(ROOT, "manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function childEnv(runId, workerIndex) {
  return {
    PATH: process.env.PATH ?? "",
    ...(runId === undefined ? {} : { E2E_EVAL_RUN_ID: runId }),
    ...(workerIndex === undefined ? {} : { TEST_WORKER_INDEX: workerIndex }),
  };
}

function runNode(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 10_000,
    killSignal: "SIGKILL",
    maxBuffer: 256 * 1024,
  });
}

function loadConfig(runId, workerIndex) {
  const source = `
    const loaded = await import(${JSON.stringify(pathToFileURL(CONFIG).href)});
    const config = loaded.default.default ?? loaded.default;
    process.stdout.write(JSON.stringify({
      runId: process.env.E2E_EVAL_RUN_ID,
      outputDir: config.outputDir,
      testMatch: config.testMatch,
      fullyParallel: config.fullyParallel,
      workers: config.workers,
      retries: config.retries,
      preserveOutput: config.preserveOutput,
      use: config.use,
    }));
  `;
  return runNode(["--import", "tsx", "--input-type=module", "--eval", source], childEnv(runId, workerIndex));
}

function parseLoaded(result) {
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("fresh coordinator Playwright CLI listing succeeds", () => {
  const runId = randomUUID();
  const result = runNode([PLAYWRIGHT_CLI, "test", "--config", CONFIG, "--list"], childEnv(runId));
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /J1 J2 J3 J4 J5/);
  assert.equal(existsSync(path.join(EVIDENCE_ROOT, runId)), false);
});

test("coordinator collision rejects and preserves its sentinel", async () => {
  const runId = randomUUID();
  const directory = path.join(EVIDENCE_ROOT, runId);
  const sentinel = path.join(directory, "sentinel.txt");
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  await mkdir(directory, { recursive: false });
  await writeFile(sentinel, "preserve-this-sentinel\n", { flag: "wx" });
  const before = await readFile(sentinel, "utf8");
  const result = runNode([PLAYWRIGHT_CLI, "test", "--config", CONFIG, "--list"], childEnv(runId));
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Playwright evidence directory already exists for this run ID/);
  assert.equal(await readFile(sentinel, "utf8"), before);
});

test("worker reload accepts the coordinator-created directory with exact privacy config", async () => {
  const runId = randomUUID();
  const directory = path.join(EVIDENCE_ROOT, runId);
  const sentinel = path.join(directory, "sentinel.txt");
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  await mkdir(directory, { recursive: false });
  await writeFile(sentinel, "worker-reload-sentinel\n", { flag: "wx" });
  const before = await readFile(sentinel, "utf8");
  const loaded = parseLoaded(loadConfig(runId, "0"));
  assert.equal(loaded.runId, runId);
  assert.equal(loaded.outputDir, path.join(directory, "artifacts"));
  assert.equal(loaded.testMatch, "platform-evaluation.spec.ts");
  assert.equal(loaded.fullyParallel, false);
  assert.equal(loaded.workers, 1);
  assert.equal(loaded.retries, 0);
  assert.equal(loaded.preserveOutput, "always");
  assert.deepEqual(loaded.use, { screenshot: "off", trace: "off", video: "off" });
  assert.equal(await readFile(sentinel, "utf8"), before);
});

for (const [label, runId] of [["ordinary", "not-a-uuid"], ["traversal", "../not-a-uuid"], ["absolute", "/tmp/not-a-uuid"], ["UUID suffix", `${randomUUID()}x`]]) {
  for (const workerIndex of [undefined, "0"]) {
    test(`${label} malformed run ID fails for ${workerIndex === undefined ? "coordinator" : "worker"}`, () => {
      const result = loadConfig(runId, workerIndex);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /E2E_EVAL_RUN_ID must be a UUID/);
    });
  }
}

for (const runId of [undefined, "", "   "]) {
  test(`run ID ${runId === undefined ? "absence" : JSON.stringify(runId)} generates a UUID`, () => {
    const loaded = parseLoaded(loadConfig(runId, "0"));
    assert.match(loaded.runId, UUID);
    assert.equal(loaded.outputDir, path.join(EVIDENCE_ROOT, loaded.runId, "artifacts"));
  });
}
