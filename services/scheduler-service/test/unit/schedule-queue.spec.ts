import { describe, it, expect } from "bun:test";
import { ScheduleQueue } from "../../src/engine/schedule-queue";

describe("ScheduleQueue", () => {
  it("inserts and pops smallest nextRunAt first", () => {
    const q = new ScheduleQueue();
    q.insert({
      scheduleId: "a",
      tenantId: "t1",
      nextRunAt: 200,
    });
    q.insert({
      scheduleId: "b",
      tenantId: "t1",
      nextRunAt: 100,
    });
    expect(q.pop()?.scheduleId).toBe("b");
    expect(q.pop()?.scheduleId).toBe("a");
    expect(q.pop()).toBeUndefined();
  });

  it("popAllDue returns entries in ascending time order and stops at future", () => {
    const q = new ScheduleQueue();
    const now = 1_000;
    q.insert({ scheduleId: "x", tenantId: "t", nextRunAt: now - 10 });
    q.insert({ scheduleId: "y", tenantId: "t", nextRunAt: now - 5 });
    q.insert({ scheduleId: "z", tenantId: "t", nextRunAt: now + 100 });
    const due = q.popAllDue(now);
    expect(due.map((e) => e.scheduleId)).toEqual(["x", "y"]);
    expect(q.size).toBe(1);
    expect(q.pop()?.scheduleId).toBe("z");
  });

  it("replace on duplicate scheduleId reorders heap", () => {
    const q = new ScheduleQueue();
    q.insert({ scheduleId: "s1", tenantId: "t", nextRunAt: 500 });
    q.insert({ scheduleId: "s1", tenantId: "t", nextRunAt: 50 });
    expect(q.popAllDue(50).map((e) => e.nextRunAt)).toEqual([50]);
  });

  it("remove returns false for unknown id", () => {
    const q = new ScheduleQueue();
    expect(q.remove("nope")).toBe(false);
  });

  it("clear empties queue", () => {
    const q = new ScheduleQueue();
    q.insert({ scheduleId: "a", tenantId: "t", nextRunAt: 1 });
    q.clear();
    expect(q.size).toBe(0);
    expect(q.pop()).toBeUndefined();
  });
});
