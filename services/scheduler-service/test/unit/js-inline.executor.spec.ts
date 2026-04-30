import { describe, it, expect, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { JsInlineExecutor } from "../../src/executors/js-inline.executor";
import {
  ExecMode,
  ScheduleType,
} from "../../src/modules/schedules/schedules.dto";
import type { ISchedule } from "../../src/modules/schedules/schedules.service";

function baseSchedule(overrides: Partial<ISchedule> = {}): ISchedule {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "inline",
    description: "",
    type: ScheduleType.CRON,
    expression: "0 0 * * *",
    exec_mode: ExecMode.JS_INLINE,
    config: {
      script: "console.log('hello');",
      timeout: 30_000,
    },
    enabled: true,
    next_run_at: "2020-01-02T00:00:00.000Z",
    last_run_at: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("JsInlineExecutor", () => {
  let executor: JsInlineExecutor;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [JsInlineExecutor],
    }).compile();
    executor = module.get(JsInlineExecutor);
  });

  it("executes simple inline JavaScript", async () => {
    const result = await executor.execute(
      baseSchedule({ config: { script: "console.log(42);", timeout: 5000 } }),
      "t1",
    );

    expect(result.status).toBe("completed");
    expect(result.output).toContain("42");
    expect(result.error).toBe("");
    expect(result.metadata?.tenantId).toBe("t1");
    expect(result.metadata?.execMode).toBe("js-inline");
  });

  it("captures console.log output", async () => {
    const result = await executor.execute(
      baseSchedule({
        config: {
          script: `
            console.log('a');
            console.log('b');
          `,
          timeout: 5000,
        },
      }),
      "t2",
    );

    expect(result.status).toBe("completed");
    expect(result.output).toContain("a");
    expect(result.output).toContain("b");
  });

  it("captures console.error with [ERR] prefix in output stream", async () => {
    const result = await executor.execute(
      baseSchedule({
        config: {
          script: `console.error('warn');`,
          timeout: 5000,
        },
      }),
      "t3",
    );

    expect(result.status).toBe("completed");
    expect(result.output).toContain("[ERR]");
    expect(result.output).toContain("warn");
  });

  it("returns failed with message on runtime errors in user script", async () => {
    const result = await executor.execute(
      baseSchedule({
        config: {
          script: `throw new Error('runtime boom');`,
          timeout: 5000,
        },
      }),
      "t4",
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("runtime boom");
  });

  it("returns failed on syntax errors via worker onerror", async () => {
    const result = await executor.execute(
      baseSchedule({
        config: {
          script: `return { {{{ invalid`,
          timeout: 5000,
        },
      }),
      "t5",
    );

    expect(result.status).toBe("failed");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns timeout when execution exceeds configured timeout", async () => {
    const result = await executor.execute(
      baseSchedule({
        config: {
          script: `for (;;) {}`,
          timeout: 30,
        },
      }),
      "t6",
    );

    expect(result.status).toBe("timeout");
    expect(result.error).toContain("timed out");
    expect(result.error).toContain("30");
    expect(result.metadata?.timeout).toBe(30);
  });
});
