import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import {
  appendSqlSetFragment,
  composeUpdateSetClause,
  joinDynamicWhereFragments,
} from "../../src/common/repository-sql.util";
import type { Sql } from "@yoizen/database";

describe("appendSqlSetFragment", () => {
  it("appends assignment fragments to the updates list", () => {
    const updates: string[] = [];
    appendSqlSetFragment(updates, "a = 1" as unknown as ReturnType<Sql>);
    appendSqlSetFragment(updates, "b = 2" as unknown as ReturnType<Sql>);
    expect(updates).toEqual(["a = 1", "b = 2"]);
  });
});

describe("composeUpdateSetClause", () => {
  it("joins fragments with comma", () => {
    expect(composeUpdateSetClause(["a = 1", "b = 2"])).toBe("a = 1, b = 2");
  });
});

describe("joinDynamicWhereFragments", () => {
  it("returns 1=1 when empty", () => {
    expect(joinDynamicWhereFragments([])).toBe("1=1");
  });

  it("joins fragments with AND", () => {
    expect(joinDynamicWhereFragments(["a = 1", "b = 2"])).toBe("a = 1 AND b = 2");
  });
});
