import "../setup-env";
import { beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock the TenantConnectionManager → returns a tagged-template SQL function
// whose responses are driven by a queue so each test can sequence results.
// ---------------------------------------------------------------------------
const sqlQueue: unknown[][] = [];
const sqlMock = mock(<T = unknown[]>() => {
  const res = sqlQueue.shift() ?? [];
  return Promise.resolve(res as unknown as T);
}) as unknown as {
  (...args: unknown[]): Promise<unknown>;
  json: ReturnType<typeof mock>;
};
// sql.json() is the postgres.js helper used by create() to serialize the
// `value` column exactly once (see system-variables.service.ts). It is not
// a queued tagged-template call, so it must not consume from sqlQueue.
sqlMock.json = mock((obj: unknown) => JSON.stringify(obj));

const mockConnectionManager = {
  ensureSchema: mock(() => Promise.resolve(sqlMock)),
  getConnection: mock(() => sqlMock),
};

// ---------------------------------------------------------------------------
// Dynamically import the service (will fail for now — RED phase)
// ---------------------------------------------------------------------------
const loadService = async () => {
  const { SystemVariablesService } = await import(
    "../../src/modules/system-variables/system-variables.service"
  );
  return SystemVariablesService;
};

const loadConflictError = async () => {
  const { SystemVariableConflictError } = await import(
    "../../src/modules/system-variables/system-variables.service"
  );
  return SystemVariableConflictError;
};

// Typed views over the bun mocks so the specs can inspect the tagged-template
// calls (one queued result is shifted per `sql` call — see update()).
const sqlCalls = sqlMock as unknown as {
  mock: { calls: unknown[][] };
  mockClear: () => void;
};
const jsonCalls = sqlMock.json as unknown as {
  mock: { calls: unknown[][] };
  mockClear: () => void;
};

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------
const TENANT = "t1";

function makeVar(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    tenant_id: TENANT,
    name: "myVar",
    type: "string" as const,
    value: "hello",
    label: "My Variable",
    description: "A test variable",
    is_active: true,
    created_at: new Date("2025-01-01"),
    updated_at: new Date("2025-01-02"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe("SystemVariablesService", () => {
  let service: Awaited<ReturnType<typeof loadService>>;

  beforeEach(async () => {
    const SystemVariablesService = await loadService();
    sqlQueue.length = 0;

    service = new SystemVariablesService(
      mockConnectionManager as unknown as never
    );
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------
  describe("findAll", () => {
    it("returns all system variables for a tenant", async () => {
      const v1 = makeVar({ id: "v1", name: "alpha", value: "a" });
      const v2 = makeVar({ id: "v2", name: "beta", type: "number", value: 42 });

      // queued SQL responses: COUNT then SELECT
      sqlQueue.push([{ count: "2" }]);
      sqlQueue.push([v1, v2]);

      const result = await service.findAll(TENANT);

      expect(result).toEqual({ variables: [v1, v2], total: 2 });
    });

    it("returns empty array for tenant with no variables", async () => {
      sqlQueue.push([{ count: "0" }]);
      sqlQueue.push([]);

      const result = await service.findAll(TENANT);

      expect(result).toEqual({ variables: [], total: 0 });
    });

    it("respects is_active filter (only active variables returned)", async () => {
      const v1 = makeVar({ id: "v1", name: "alpha", is_active: true });
      const v2 = makeVar({ id: "v2", name: "beta", is_active: true });

      sqlQueue.push([{ count: "2" }]);
      sqlQueue.push([v1, v2]);

      const result = await service.findAll(TENANT);

      expect(result.variables).toHaveLength(2);
      expect(result.variables.every((v) => v.is_active === true)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------
  describe("findById", () => {
    it("returns a variable by ID", async () => {
      const v = makeVar({ id: "v10", name: "target" });
      sqlQueue.push([v]);

      const result = await service.findById(TENANT, "v10");

      expect(result).toEqual(v);
    });

    it("returns null for non-existent ID", async () => {
      sqlQueue.push([]);

      const result = await service.findById(TENANT, "nope");

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe("create", () => {
    it("creates a new variable and returns it", async () => {
      const dto = { name: "newVar", type: "string" as const, value: "hello" };
      const created = makeVar({
        id: "new-id",
        name: "newVar",
        type: "string",
        value: "hello",
      });

      sqlQueue.push([created]);

      const result = await service.create(TENANT, dto);

      expect(result).toEqual(created);
      expect(result.name).toBe("newVar");
    });

    it('sets value to "hello" for string type', async () => {
      const dto = { name: "s", type: "string" as const, value: "hello" };
      const created = makeVar({
        id: "s1",
        name: "s",
        type: "string",
        value: "hello",
      });
      sqlQueue.push([created]);

      const result = await service.create(TENANT, dto);

      expect(result.type).toBe("string");
      expect(result.value).toBe("hello");
    });

    it("sets value to 42 for number type", async () => {
      const dto = { name: "n", type: "number" as const, value: 42 };
      const created = makeVar({
        id: "n1",
        name: "n",
        type: "number",
        value: 42,
      });
      sqlQueue.push([created]);

      const result = await service.create(TENANT, dto);

      expect(result.type).toBe("number");
      expect(result.value).toBe(42);
    });

    it("sets value to true for boolean type", async () => {
      const dto = { name: "b", type: "boolean" as const, value: true };
      const created = makeVar({
        id: "b1",
        name: "b",
        type: "boolean",
        value: true,
      });
      sqlQueue.push([created]);

      const result = await service.create(TENANT, dto);

      expect(result.type).toBe("boolean");
      expect(result.value).toBe(true);
    });

    it("sets value to [1,2,3] for array type", async () => {
      const dto = { name: "arr", type: "array" as const, value: [1, 2, 3] };
      const created = makeVar({
        id: "a1",
        name: "arr",
        type: "array",
        value: [1, 2, 3],
      });
      sqlQueue.push([created]);

      const result = await service.create(TENANT, dto);

      expect(result.type).toBe("array");
      expect(result.value).toEqual([1, 2, 3]);
    });

    it('sets value to {"key":"val"} for json type', async () => {
      const dto = {
        name: "j",
        type: "json" as const,
        value: { key: "val" },
      };
      const created = makeVar({
        id: "j1",
        name: "j",
        type: "json",
        value: { key: "val" },
      });
      sqlQueue.push([created]);

      const result = await service.create(TENANT, dto);

      expect(result.type).toBe("json");
      expect(result.value).toEqual({ key: "val" });
    });

    it("create rejects duplicate name", async () => {
      const dto = {
        name: "duplicate",
        type: "string" as const,
        value: "hello",
      };

      const dupError = new Error(
        'duplicate key value violates unique constraint "idx_system_variables_tenant_id_name"'
      );
      // Push a rejected promise so the INSERT throws
      sqlQueue.push(Promise.reject(dupError));

      await expect(service.create(TENANT, dto)).rejects.toThrow(
        "duplicate key value violates unique constraint"
      );
    });

    it("create handles special characters in name", async () => {
      const dto = {
        name: "My Company Name",
        type: "string" as const,
        value: "hello",
      };
      const created = makeVar({
        id: "special-id",
        name: "My Company Name",
        type: "string",
        value: "hello",
      });

      sqlQueue.push([created]);

      const result = await service.create(TENANT, dto);

      expect(result.name).toBe("My Company Name");
    });

    // -----------------------------------------------------------------------
    // Soft-delete reactivation (ON CONFLICT DO UPDATE … WHERE is_active = false)
    // -----------------------------------------------------------------------
    it("reactivates a soft-deleted variable and updates its mutable fields", async () => {
      const dto = {
        name: "crm-support-company-name",
        type: "string" as const,
        value: "ACME Corp",
        label: "Company Name",
        description: "Reactivated description",
      };
      // The DO UPDATE branch returns the pre-existing row (its own id), now
      // active and carrying the new values.
      const reactivated = makeVar({
        id: "pre-existing-id",
        name: "crm-support-company-name",
        type: "string",
        value: "ACME Corp",
        label: "Company Name",
        description: "Reactivated description",
        is_active: true,
      });

      sqlQueue.push([reactivated]);

      const result = await service.create(TENANT, dto);

      expect(result).toEqual(reactivated);
      expect(result.id).toBe("pre-existing-id");
      expect(result.value).toBe("ACME Corp");
      expect(result.label).toBe("Company Name");
      expect(result.description).toBe("Reactivated description");
    });

    it("issues a single upsert query with the ON CONFLICT reactivation clause", async () => {
      sqlCalls.mockClear();
      const dto = { name: "upsertVar", type: "string" as const, value: "hi" };
      sqlQueue.push([makeVar({ id: "u1", name: "upsertVar" })]);

      await service.create(TENANT, dto);

      // ONE tagged-template call: the mock shifts exactly one queued result.
      expect(sqlCalls.mock.calls).toHaveLength(1);
      const strings = sqlCalls.mock.calls[0]![0] as unknown as string[];
      const query = Array.from(strings).join("?");
      expect(query).toContain("INSERT INTO system_variables");
      expect(query).toContain("ON CONFLICT (tenant_id, name) DO UPDATE");
      expect(query).toContain("is_active = true");
      expect(query).toContain("type = EXCLUDED.type");
      expect(query).toContain("value = EXCLUDED.value");
      expect(query).toContain("label = EXCLUDED.label");
      expect(query).toContain("description = EXCLUDED.description");
      expect(query).toContain("updated_at = NOW()");
      expect(query).toContain("WHERE system_variables.is_active = false");
    });

    it("serializes `value` with sql.json() exactly once (no double encoding)", async () => {
      jsonCalls.mockClear();
      const dto = {
        name: "j2",
        type: "json" as const,
        value: { key: "val" },
      };
      sqlQueue.push([makeVar({ id: "j2", name: "j2", value: { key: "val" } })]);

      await service.create(TENANT, dto);

      // Single sql.json() call with the RAW value: the EXCLUDED.value path
      // reuses the same bound parameter, so nothing is re-stringified.
      expect(jsonCalls.mock.calls).toHaveLength(1);
      expect(jsonCalls.mock.calls[0]![0]).toEqual({ key: "val" });
    });

    it("throws SystemVariableConflictError when an ACTIVE duplicate exists", async () => {
      const SystemVariableConflictError = await loadConflictError();
      const dto = {
        name: "crm-support-company-name",
        type: "string" as const,
        value: "ACME Corp",
      };
      // Active duplicate: the DO UPDATE's WHERE fails, so no row comes back.
      sqlQueue.push([]);

      const promise = service.create(TENANT, dto);

      await expect(promise).rejects.toBeInstanceOf(SystemVariableConflictError);
    });

    it("conflict error names the conflicting variable", async () => {
      const dto = {
        name: "crm-support-company-name",
        type: "string" as const,
        value: "ACME Corp",
      };
      sqlQueue.push([]);

      try {
        await service.create(TENANT, dto);
        throw new Error("expected SystemVariableConflictError");
      } catch (err) {
        const conflict = err as { variableName?: string; message: string };
        expect(conflict.variableName).toBe("crm-support-company-name");
        expect(conflict.message).toContain("crm-support-company-name");
      }
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  describe("update", () => {
    it("updates name and value", async () => {
      const updated = makeVar({
        id: "v1",
        name: "renamed",
        type: "string",
        value: "world",
      });
      sqlQueue.push([updated]);

      const result = await service.update(TENANT, "v1", {
        name: "renamed",
        value: "world",
      });

      expect(result).toEqual(updated);
      expect(result.name).toBe("renamed");
      expect(result.value).toBe("world");
    });

    it("returns null for non-existent ID", async () => {
      sqlQueue.push([]);

      const result = await service.update(TENANT, "nope", {
        name: "ghost",
      });

      expect(result).toBeNull();
    });

    it("update can change only label", async () => {
      const updated = makeVar({
        id: "v1",
        name: "myVar",
        type: "string",
        value: "hello",
        label: "New Label",
      });
      sqlQueue.push([updated]);

      const result = await service.update(TENANT, "v1", {
        label: "New Label",
      });

      expect(result).toBeDefined();
      expect(result!.label).toBe("New Label");
      expect(result!.name).toBe("myVar");
      expect(result!.type).toBe("string");
      expect(result!.value).toBe("hello");
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe("delete", () => {
    it("soft-deletes (sets is_active=false) and returns true", async () => {
      const deleted = makeVar({ id: "v1", is_active: false });
      sqlQueue.push([deleted]);

      const result = await service.delete(TENANT, "v1");

      expect(result).toBe(true);
    });

    it("returns false for non-existent ID", async () => {
      sqlQueue.push([]);

      const result = await service.delete(TENANT, "nope");

      expect(result).toBe(false);
    });
  });
});
