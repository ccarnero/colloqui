import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mock the TenantConnectionManager → returns a tagged-template SQL function
// whose responses are driven by a queue so each test can sequence results.
// ---------------------------------------------------------------------------
const sqlQueue: unknown[][] = [];

/**
 * Create a tagged-template-mimicking function with postgres.js helper methods.
 *
 * - Called as a tagged template (`sql\`SELECT …\``) → dequeues from sqlQueue
 * - `sql.array(arr)` → returns the array (wrapped in mock() for testability)
 * - `sql.json(obj)` → returns JSON.stringify(obj)
 * - `sql.unsafe(str)` → returns the string as-is
 */
function createSqlMock() {
  const fn = mock(<T = unknown[]>() => {
    const res = sqlQueue.shift() ?? [];
    return Promise.resolve(res as unknown as T);
  }) as unknown as ReturnType<typeof createSqlMock>;

  fn.array = mock((arr: unknown[]) => arr);
  fn.json = mock((obj: unknown) => JSON.stringify(obj));
  fn.unsafe = mock((str: string) => str);

  return fn;
}

let sqlMock: ReturnType<typeof createSqlMock>;

const mockConnectionManager = {
  ensureSchema: mock(() => Promise.resolve(sqlMock)),
  getConnection: mock(() => sqlMock),
};

const mockNatsPublisher = {
  publishSkillChanged: mock(() => Promise.resolve(null)),
};

// ---------------------------------------------------------------------------
// Dynamically import the service
// ---------------------------------------------------------------------------
const loadService = async () => {
  const { SkillsService } = await import(
    "../../src/modules/skills/skills.service"
  );
  return SkillsService;
};

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------
const TENANT = "t1";

/**
 * Build a mock DB skill row.
 *
 * Includes all ISkill fields (including BUG-2 new fields) with sensible
 * defaults.  Individual tests can override any field via `overrides`.
 */
function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    tenant_id: TENANT,
    name: "test-skill",
    description: "A test skill",
    system_prompt: "You are a helpful assistant",
    icon: "smart_toy",
    color: "#42a5f5",
    trigger_commands: ["/hello", "/help"],
    files: [],
    metadata: {},
    is_active: true,
    // BUG-2 new fields — included by default so tests can assert on them
    when_to_use: "",
    priority: 0,
    allowed_tools: [],
    mode: "llm_driven",
    created_at: new Date("2025-01-01"),
    updated_at: new Date("2025-01-02"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe("SkillsService — BUG-2 new fields", () => {
  let service: Awaited<ReturnType<typeof loadService>>;

  beforeEach(async () => {
    const SkillsService = await loadService();
    sqlQueue.length = 0;
    sqlMock = createSqlMock();
    mockConnectionManager.ensureSchema = mock(() => Promise.resolve(sqlMock));
    mockNatsPublisher.publishSkillChanged.mockClear();

    service = new SkillsService(
      mockConnectionManager as unknown as never,
      mockNatsPublisher as unknown as never,
    );
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe("create", () => {
    it("inserts new fields (when_to_use, priority, allowed_tools, mode) into DB (T6)", async () => {
      // The mock must return a row that includes the new fields with
      // the exact values the DTO provided — the service INSERTs them
      // and the DB returns them via RETURNING *.
      sqlQueue.push([
        makeSkill({
          id: "new-id",
          when_to_use: "When user asks about pricing",
          priority: 5,
          allowed_tools: ["communicate", "search_tickets"],
          mode: "router",
        }),
      ]);

      const result = await service.create(TENANT, {
        name: "pricing-skill",
        system_prompt: "Pricing assistant",
        when_to_use: "When user asks about pricing",
        priority: 5,
        allowed_tools: ["communicate", "search_tickets"],
        mode: "router",
      });

      expect(result.when_to_use).toBe("When user asks about pricing");
      expect(result.priority).toBe(5);
      expect(result.allowed_tools).toEqual(["communicate", "search_tickets"]);
      expect(result.mode).toBe("router");
    });

    it("assigns defaults for optional new fields when not provided (T7)", async () => {
      sqlQueue.push([makeSkill({ id: "new-id" })]);

      const result = await service.create(TENANT, {
        name: "minimal-skill",
        system_prompt: "You are helpful",
      });

      expect(result.when_to_use).toBe("");
      expect(result.priority).toBe(0);
      expect(result.allowed_tools).toEqual([]);
      expect(result.mode).toBe("llm_driven");
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  describe("update", () => {
    it("updates individual new fields (T8)", async () => {
      // The update() method builds dynamic SET clauses by calling
      // sql`field = ${value}` for each defined field (4 calls) plus the
      // full UPDATE query (1 call). Push dummy items for SET clause
      // building, then the real data for the RETURNING *.
      sqlQueue.push([]); // SET: when_to_use
      sqlQueue.push([]); // SET: priority
      sqlQueue.push([]); // SET: allowed_tools
      sqlQueue.push([]); // SET: mode
      sqlQueue.push([
        makeSkill({
          id: "s1",
          when_to_use: "Updated usage",
          priority: 99,
          allowed_tools: ["communicate"],
          mode: "inline",
        }),
      ]); // full UPDATE

      const result = await service.update(TENANT, "s1", {
        when_to_use: "Updated usage",
        priority: 99,
        allowed_tools: ["communicate"],
        mode: "inline",
      });

      expect(result!.when_to_use).toBe("Updated usage");
      expect(result!.priority).toBe(99);
      expect(result!.allowed_tools).toEqual(["communicate"]);
      expect(result!.mode).toBe("inline");
    });

    it("returns null when skill not found (T9)", async () => {
      sqlQueue.push([]);

      const result = await service.update(TENANT, "non-existent", {
        name: "ghost",
      });

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------
  describe("findAll", () => {
    it("returns skills with all new fields in response (T10)", async () => {
      sqlQueue.push([makeSkill(), makeSkill({ id: "s2", name: "second" })]);

      const result = await service.findAll(TENANT);

      expect(result.skills).toHaveLength(2);

      for (const skill of result.skills) {
        expect(skill).toHaveProperty("when_to_use");
        expect(skill).toHaveProperty("priority");
        expect(skill).toHaveProperty("allowed_tools");
        expect(skill).toHaveProperty("mode");
      }
    });
  });

  // -------------------------------------------------------------------------
  // NATS integration — BUG-3
  // -------------------------------------------------------------------------
  describe("NATS events", () => {
    it("emits skill.changed (created) after successful create", async () => {
      sqlQueue.push([makeSkill({ id: "new-id", name: "test-create-nats" })]);

      await service.create(TENANT, {
        name: "test-create-nats",
        system_prompt: "You are Test",
      });

      expect(mockNatsPublisher.publishSkillChanged).toHaveBeenCalledTimes(1);
      const [tId, skillId, action, skillData] =
        mockNatsPublisher.publishSkillChanged.mock.calls[0];
      expect(tId).toBe(TENANT);
      expect(skillId).toBe("new-id");
      expect(action).toBe("created");
      expect(skillData).toEqual({ name: "test-create-nats" });
    });

    it("emits skill.changed (updated) after successful update", async () => {
      // update() calls sql`name = ${...}` as SET clause (1st dequeue)
      // and then the full UPDATE query (2nd dequeue)
      sqlQueue.push([]); // first: the `name = $name` tagged template call
      sqlQueue.push([makeSkill({ id: "s1", name: "updated-name" })]); // second: the actual UPDATE

      await service.update(TENANT, "s1", { name: "updated-name" });

      expect(mockNatsPublisher.publishSkillChanged).toHaveBeenCalledTimes(1);
      const [tId, skillId, action, skillData] =
        mockNatsPublisher.publishSkillChanged.mock.calls[0];
      expect(tId).toBe(TENANT);
      expect(skillId).toBe("s1");
      expect(action).toBe("updated");
      expect(skillData).toEqual({ name: "updated-name" });
    });

    it("emits skill.changed (deleted) after successful delete", async () => {
      sqlQueue.push([{ id: "s1" }]);

      await service.delete(TENANT, "s1");

      expect(mockNatsPublisher.publishSkillChanged).toHaveBeenCalledTimes(1);
      const [tId, skillId, action] =
        mockNatsPublisher.publishSkillChanged.mock.calls[0];
      expect(tId).toBe(TENANT);
      expect(skillId).toBe("s1");
      expect(action).toBe("deleted");
    });

    it("does not emit skill.changed when update returns null", async () => {
      // First dequeue: sql`name = ${...}` SET clause (returns empty row)
      // Second dequeue: the actual UPDATE (returns empty → null)
      sqlQueue.push([]);
      sqlQueue.push([]);

      const result = await service.update(TENANT, "ghost", { name: "x" });

      expect(result).toBeNull();
      expect(mockNatsPublisher.publishSkillChanged).not.toHaveBeenCalled();
    });

    it("does not emit skill.changed when delete affects no rows", async () => {
      sqlQueue.push([]);

      const result = await service.delete(TENANT, "ghost");

      expect(result).toBe(false);
      expect(mockNatsPublisher.publishSkillChanged).not.toHaveBeenCalled();
    });

    it("does not throw when NATS publish fails (caught + logged)", async () => {
      sqlQueue.push([makeSkill({ id: "failing-nats" })]);
      mockNatsPublisher.publishSkillChanged.mockImplementation(() =>
        Promise.reject(new Error("NATS unavailable")),
      );

      const result = await service.create(TENANT, {
        name: "should-not-throw",
        system_prompt: "You are fine",
      });

      // The skill was still created despite NATS failure
      expect(result).toBeDefined();
      expect(result.id).toBe("failing-nats");
      expect(mockNatsPublisher.publishSkillChanged).toHaveBeenCalled();
    });
  });
});
