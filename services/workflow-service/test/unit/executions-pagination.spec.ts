import { describe, expect, it, mock } from "bun:test";
import { ExecutionsMongoRepository } from "../../src/modules/workflows/executions.mongo.repository";
import { ExecutionsPostgresRepository } from "../../src/modules/workflows/executions.postgres.repository";
import type { IWorkflowExecutionRow } from "../../src/modules/workflows/executions.repository.interface";
import { makeFakeTenantMongoConnections, makeMockDb } from "../make-mongo-mock";

const timestamp = new Date("2026-09-05T00:00:00.000Z");
const rows: IWorkflowExecutionRow[] = Array.from({ length: 205 }, (_, index) => ({
  id: `execution-${String(index).padStart(3, "0")}`,
  definition_id: "definition-1",
  temporal_workflow_id: `workflow-${index}`,
  temporal_run_id: `run-${index}`,
  correlation_id: null,
  request: {},
  status: "RUNNING",
  created_at: timestamp,
  updated_at: timestamp,
}));

// Local boundary doubles only, not live DB tests. All timestamps tie: apply the
// emitted unique-key direction before slicing, with varying input order per page.
describe("definition execution pagination (boundary doubles)", () => {
  for (const sort of ["asc", "desc"] as const) {
    it(`Postgres preserves full equal-timestamp coverage in ${sort} order`, async () => {
      const direction = sort === "asc" ? "ASC" : "DESC";
      const sql = mock((strings: TemplateStringsArray, ...values: unknown[]): unknown => {
        const query = strings.join("?").replace(/\s+/g, " ").trim();
        if (!query.startsWith("SELECT")) return query;
        expect(query).toContain("WHERE definition_id = ? ORDER BY ? LIMIT ? OFFSET ?");
        const [definitionId, order, limit, offset] = values;
        expect(definitionId).toBe("definition-1");
        expect(order).toBe(`created_at ${direction}, id ${direction}`);
        expect(limit).toBe(100);
        const emittedDirection = String(order).endsWith("id ASC") ? 1 : -1;
        const input = Number(offset) === 100 ? [...rows].reverse() : [...rows];
        return Promise.resolve(input
          .sort((a, b) => emittedDirection * a.id.localeCompare(b.id))
          .slice(Number(offset), Number(offset) + Number(limit)));
      });
      const ensureSchema = mock(async () => sql);
      const repository = new ExecutionsPostgresRepository(
        { ensureSchema } as unknown as ConstructorParameters<typeof ExecutionsPostgresRepository>[0],
      );
      const found: string[] = [];
      for (const offset of [0, 100, 200, 300]) {
        const page = await repository.findExecutionsByDefinition({
          tenantId: "tenant-1", definitionId: "definition-1", limit: 100, offset, sort,
        });
        expect(page).toHaveLength(offset < 200 ? 100 : offset === 200 ? 5 : 0);
        found.push(...page.map((row) => row.id));
      }
      const expected = rows.map((row) => row.id);
      expect(found).toEqual(sort === "asc" ? expected : expected.reverse());
      expect(new Set(found).size).toBe(205);
      expect(ensureSchema).toHaveBeenCalledTimes(4);
      expect(ensureSchema).toHaveBeenCalledWith("tenant-1");
    });

    it(`Mongo preserves full equal-timestamp coverage in ${sort} order`, async () => {
      const direction = sort === "asc" ? 1 : -1;
      const find = mock((filter: unknown) => {
        expect(filter).toEqual({ definition_id: "definition-1" });
        return {
          sort: mock((order: { created_at: number; _id: number }) => {
            expect(Object.entries(order)).toEqual([["created_at", direction], ["_id", direction]]);
            return {
              skip: mock((offset: number) => ({
                limit: mock((limit: number) => {
                  expect(limit).toBe(100);
                  const input = offset === 100 ? [...rows].reverse() : [...rows];
                  return {
                    toArray: mock(async () => input
                      .sort((a, b) => order._id * a.id.localeCompare(b.id))
                      .slice(offset, offset + limit)
                      .map(({ id, ...row }) => ({ ...row, _id: id }))),
                  };
                }),
              })),
            };
          }),
        };
      });
      const connections = makeFakeTenantMongoConnections(makeMockDb({ workflow_executions: { find } }));
      const repository = new ExecutionsMongoRepository(connections);
      const found: string[] = [];
      for (const offset of [0, 100, 200, 300]) {
        const page = await repository.findExecutionsByDefinition({
          tenantId: "tenant-1", definitionId: "definition-1", limit: 100, offset, sort,
        });
        expect(page).toHaveLength(offset < 200 ? 100 : offset === 200 ? 5 : 0);
        found.push(...page.map((row) => row.id));
      }
      const expected = rows.map((row) => row.id);
      expect(found).toEqual(sort === "asc" ? expected : expected.reverse());
      expect(new Set(found).size).toBe(205);
      expect(connections.ensureSchemaCalls.get("tenant-1")).toBe(4);
    });
  }
});
