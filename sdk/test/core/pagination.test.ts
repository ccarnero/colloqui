import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageResult } from "../../src/core/pagination.js";
import {
  paginate,
  toOffsetPage,
  toSinglePage,
} from "../../src/core/pagination.js";

test("iterates every item across multiple limit/offset pages", async () => {
  const all = Array.from({ length: 5 }, (_, i) => i);
  const calls: Array<{ limit: number; offset: number }> = [];

  const fetchPage = async ({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<PageResult<number>> => {
    calls.push({ limit, offset });
    const items = all.slice(offset, offset + limit);
    return toOffsetPage(items, all.length, offset);
  };

  const seen: number[] = [];
  for await (const item of paginate(fetchPage, { pageSize: 2 })) {
    seen.push(item);
  }

  assert.deepEqual(seen, all);
  assert.deepEqual(
    calls.map((c) => c.offset),
    [0, 2, 4]
  );
});

test("degrades to a single page for unpaginated (bare-array) endpoints", async () => {
  const all = ["a", "b", "c"];
  const fetchPage = async () => toSinglePage(all);

  const seen: string[] = [];
  for await (const item of paginate(fetchPage)) {
    seen.push(item);
  }
  assert.deepEqual(seen, all);
});

test("stops when a page reports hasMore=false, even if items are non-empty", async () => {
  let calls = 0;
  const fetchPage = async (): Promise<PageResult<number>> => {
    calls++;
    return { items: [1, 2], hasMore: false };
  };
  const seen: number[] = [];
  for await (const item of paginate(fetchPage)) {
    seen.push(item);
  }
  assert.deepEqual(seen, [1, 2]);
  assert.equal(calls, 1);
});

test("stops on an empty page even if hasMore was true (infinite-loop guard)", async () => {
  let calls = 0;
  const fetchPage = async (): Promise<PageResult<number>> => {
    calls++;
    return { items: [], hasMore: true };
  };
  const seen: number[] = [];
  for await (const item of paginate(fetchPage)) {
    seen.push(item);
  }
  assert.deepEqual(seen, []);
  assert.equal(calls, 1);
});

test(".page() escape hatch fetches one page directly without iterating", async () => {
  const calls: Array<{ limit: number; offset: number }> = [];
  const fetchPage = async ({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }) => {
    calls.push({ limit, offset });
    return toOffsetPage(["x", "y"], 10, offset);
  };
  const p = paginate(fetchPage, { pageSize: 5 });
  const page = await p.page({ offset: 5 });
  assert.equal(calls.length, 1);
  assert.deepEqual(page.items, ["x", "y"]);
  assert.equal(page.total, 10);
  assert.equal(page.hasMore, true);
});

test("toOffsetPage computes hasMore/nextOffset from total", () => {
  const notLast = toOffsetPage(["a", "b"], 5, 0);
  assert.equal(notLast.hasMore, true);
  assert.equal(notLast.nextOffset, 2);

  const last = toOffsetPage(["a"], 3, 2);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextOffset, 3);
});

test("toSinglePage always reports hasMore=false and total=items.length", () => {
  const page = toSinglePage([1, 2, 3]);
  assert.equal(page.hasMore, false);
  assert.equal(page.total, 3);
});
