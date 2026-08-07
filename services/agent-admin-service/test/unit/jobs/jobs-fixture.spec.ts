import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidSchedule } from "../../../src/modules/jobs/schedule.validator";

/**
 * Lint test for the reference fixture `data/jobs.yaml`.
 *
 * The fixture has NO runtime consumer — nothing loads it, so it silently rots
 * away from the real job contract while new devs keep copying it. This spec is
 * its only guard: it asserts the fixture matches the shapes the platform
 * actually enforces (IJob field names, the schedule validator, and the
 * agent-ai-service job executor dispatch table).
 */

const FIXTURE_PATH = join(import.meta.dir, "../../../data/jobs.yaml");

/**
 * Action types the executor dispatches on.
 * Duplicated on purpose from
 * `services/agent-ai-service/src/modules/job-executor/job-executor.service.ts` (executeJob switch)
 * (anything outside this list hits `default:` → `Unknown action type` →
 * `execution_failed`). Cross-service duplication is accepted here because this
 * is a fixture lint, not production code — the contract stays in the executor.
 */
const EXECUTOR_ACTION_TYPES = [
  "llm_call",
  "webhook",
  "function",
  "agent_task",
] as const;

/**
 * Builtin functions registered by
 * `services/agent-ai-service/src/modules/job-executor/actions/function-action.service.ts:61-83`.
 * Same duplication rationale as EXECUTOR_ACTION_TYPES. An unregistered name
 * throws `Unknown function: '<name>'` at execution time.
 */
const BUILTIN_FUNCTIONS = [
  "cleanup_old_conversations",
  "get_conversation_metrics",
  "export_data",
  "notify_backend",
] as const;

interface FixtureJob {
  id?: unknown;
  name?: unknown;
  is_active?: unknown;
  enabled?: unknown;
  agent_id?: unknown;
  schedule?: unknown;
  payload?: Record<string, unknown>;
}

function loadFixtureJobs(): FixtureJob[] {
  const raw = readFileSync(FIXTURE_PATH, "utf8");
  const parsed = Bun.YAML.parse(raw) as { jobs?: unknown };
  expect(Array.isArray(parsed?.jobs)).toBe(true);
  return parsed.jobs as FixtureJob[];
}

describe("data/jobs.yaml reference fixture", () => {
  const jobs = loadFixtureJobs();

  it("declares at least one reference job", () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  // Regression (E7): `interval:<n>` is MINUTES (schedule.validator.ts:15,55), so
  // the previous `interval:3600` meant 60 h while the job described itself as
  // hourly. isValidSchedule accepts both, hence this explicit unit assertion.
  it("expresses the hourly metrics snapshot as `interval:60` (minutes, not seconds)", () => {
    const metricsJob = jobs.find((job) => job.id === "job-metrics-snapshot");
    expect(metricsJob).toBeDefined();
    expect(metricsJob?.schedule).toBe("interval:60");
  });

  for (const [index, job] of jobs.entries()) {
    const label = typeof job.id === "string" ? job.id : `job[${index}]`;

    describe(label, () => {
      // ── IJob field names (jobs.repository.interface.ts:9) ─────────────────
      it("uses `is_active` (boolean) and never the legacy `enabled` key", () => {
        expect(job).not.toHaveProperty("enabled");
        expect(typeof job.is_active).toBe("boolean");
      });

      // ── schedule contract (schedule.validator.ts) ─────────────────────────
      it("declares a schedule accepted by the real schedule validator", () => {
        expect(typeof job.schedule).toBe("string");
        expect(isValidSchedule(job.schedule)).toBe(true);
      });

      // ── executor dispatch (job-executor.service.ts:63,71-116) ─────────────
      it("declares a payload.action_type the executor can dispatch", () => {
        const payload = job.payload;
        expect(payload).toBeDefined();
        expect(payload).not.toHaveProperty("action"); // legacy key, ignored by the executor

        const actionType = payload?.action_type;
        expect(typeof actionType).toBe("string");
        expect(EXECUTOR_ACTION_TYPES).toContain(
          actionType as (typeof EXECUTOR_ACTION_TYPES)[number]
        );
      });

      // ── function actions (function-action.service.ts:61-83) ───────────────
      it("names only registered builtin functions for `function` actions", () => {
        const payload = job.payload ?? {};
        if (payload.action_type !== "function") {
          return;
        }

        const actionConfig = payload.action_config as
          | Record<string, unknown>
          | undefined;
        expect(actionConfig).toBeDefined();

        const functionName = actionConfig?.function;
        expect(typeof functionName).toBe("string");
        expect(BUILTIN_FUNCTIONS).toContain(
          functionName as (typeof BUILTIN_FUNCTIONS)[number]
        );
      });
    });
  }
});
