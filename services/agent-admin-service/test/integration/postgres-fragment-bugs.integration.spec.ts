import "../setup-env";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * Real-Postgres regression coverage for live-cluster bugs:
 *
 *  BUG 1 — SkillsService.update() built its dynamic SET clause by pushing
 *  postgres.js tagged-template fragments into a plain string[] and joining
 *  them with Array.prototype.join(), which stringifies each fragment via
 *  .toString() and loses its parameter bindings. That produced invalid SQL
 *  and a 500 on every update. The fix composes fragments the same way
 *  config-files.postgres.repository.ts and jobs.postgres.repository.ts
 *  already do: `setClause = sql\`${setClause}, col = ${value}\``.
 *
 *  BUG 2 — SystemVariablesService.create() wrote `${JSON.stringify(value)}::jsonb`.
 *  Because the parameter's inferred type is left unspecified, postgres.js
 *  resolves it from the server's ParameterDescription reply — which reports
 *  jsonb (due to the `::jsonb` cast) — and then re-applies its own jsonb
 *  serializer (JSON.stringify) on top of the value that was already
 *  stringified by hand, storing a JSON string of JSON text. update() avoided
 *  this because it embeds the pre-stringified value as a raw SQL literal via
 *  sql.unsafe(), never going through parameter binding. The fix uses
 *  sql.json(value) (the same helper skills.service.ts and
 *  jobs.postgres.repository.ts already use for jsonb columns) so postgres.js
 *  serializes the value exactly once, for both create and update.
 *
 *  BUG 3 — JobsPostgresRepository.delete() ran a bare
 *  `DELETE FROM jobs WHERE id = ...`. job_executions.job_id references
 *  jobs(id) with no ON DELETE clause (default NO ACTION), so deleting a job
 *  that has at least one execution raised a raw foreign_key_violation
 *  (23503) that bubbled up as an unhandled 500. The fix wraps the delete in
 *  a transaction (sql.begin) that removes the job's job_executions rows
 *  first and then the job row, mirroring the fragment-composition style
 *  already used elsewhere in this file.
 *
 * These bugs are invisible to the queue-based bun:test mocks used elsewhere
 * in this service (they never execute real SQL), so this suite talks to an
 * actual Postgres instance. It requires a reachable Postgres — set
 * TEST_POSTGRES_URL (e.g. postgres://postgres:test@localhost:15432/test) to
 * run it; otherwise the suite is skipped.
 */
const TEST_POSTGRES_URL = process.env.TEST_POSTGRES_URL;

describe.skipIf(!TEST_POSTGRES_URL)(
  "SkillsService + SystemVariablesService against real Postgres",
  () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sql: any;
    let SkillsService: typeof import("../../src/modules/skills/skills.service").SkillsService;
    let SystemVariablesService: typeof import("../../src/modules/system-variables/system-variables.service").SystemVariablesService;
    let skillsService: InstanceType<typeof SkillsService>;
    let systemVariablesService: InstanceType<typeof SystemVariablesService>;

    const TENANT = "fragment-bug-tenant";
    const noopNatsPublisher = {
      publishSkillChanged: async () => null,
    };

    beforeAll(async () => {
      const postgres = (await import("postgres")).default;
      sql = postgres(TEST_POSTGRES_URL as string);

      await sql`
        CREATE TABLE IF NOT EXISTS skills (
          id UUID PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT DEFAULT '',
          system_prompt TEXT NOT NULL,
          icon VARCHAR(50) DEFAULT 'smart_toy',
          color VARCHAR(7) DEFAULT '#42a5f5',
          trigger_commands TEXT[] DEFAULT '{}',
          when_to_use TEXT DEFAULT '',
          priority INTEGER DEFAULT 0,
          allowed_tools TEXT[] DEFAULT '{}',
          mode VARCHAR(20) DEFAULT 'llm_driven',
          metadata JSONB DEFAULT '{}'::jsonb,
          files JSONB DEFAULT '[]'::jsonb,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS system_variables (
          id UUID PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL,
          value JSONB NOT NULL DEFAULT 'null'::jsonb,
          label VARCHAR(255),
          description TEXT,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`DELETE FROM skills WHERE tenant_id = ${TENANT}`;
      await sql`DELETE FROM system_variables WHERE tenant_id = ${TENANT}`;

      ({ SkillsService } = await import(
        "../../src/modules/skills/skills.service"
      ));
      ({ SystemVariablesService } = await import(
        "../../src/modules/system-variables/system-variables.service"
      ));

      const connectionManager = {
        ensureSchema: async () => sql,
        getConnection: () => sql,
      };

      skillsService = new SkillsService(
        connectionManager as never,
        noopNatsPublisher as never
      );
      systemVariablesService = new SystemVariablesService(
        connectionManager as never
      );
    });

    afterAll(async () => {
      await sql`DELETE FROM skills WHERE tenant_id = ${TENANT}`;
      await sql`DELETE FROM system_variables WHERE tenant_id = ${TENANT}`;
      await sql.end();
    });

    // -------------------------------------------------------------------
    // BUG 1 — skills.update() SQL fragment composition
    // -------------------------------------------------------------------
    describe("SkillsService.update — dynamic SET clause", () => {
      it("updates a single field without a 500 / SQL error", async () => {
        const created = await skillsService.create(TENANT, {
          name: "single-field-skill",
          system_prompt: "You are helpful",
        });

        const updated = await skillsService.update(TENANT, created.id, {
          description: "new description",
        });

        expect(updated).not.toBeNull();
        expect(updated!.description).toBe("new description");
        expect(updated!.name).toBe("single-field-skill");
      });

      it("updates multiple fields at once", async () => {
        const created = await skillsService.create(TENANT, {
          name: "multi-field-skill",
          system_prompt: "You are helpful",
        });

        const updated = await skillsService.update(TENANT, created.id, {
          name: "renamed-skill",
          priority: 7,
          allowed_tools: ["search", "communicate"],
          mode: "router",
        });

        expect(updated).not.toBeNull();
        expect(updated!.name).toBe("renamed-skill");
        expect(updated!.priority).toBe(7);
        expect(updated!.allowed_tools).toEqual(["search", "communicate"]);
        expect(updated!.mode).toBe("router");

        // Verify persisted values by reading back directly.
        const persisted = await skillsService.findById(TENANT, created.id);
        expect(persisted!.name).toBe("renamed-skill");
        expect(persisted!.priority).toBe(7);
        expect(persisted!.allowed_tools).toEqual(["search", "communicate"]);
      });

      it("soft-deactivates via is_active without crashing", async () => {
        const created = await skillsService.create(TENANT, {
          name: "deactivate-skill",
          system_prompt: "You are helpful",
        });

        const updated = await skillsService.update(TENANT, created.id, {
          is_active: false,
        });

        expect(updated).not.toBeNull();
        expect(updated!.is_active).toBe(false);
        // findById only returns active skills — deactivated rows fall out
        // of the default lookup, matching soft-delete semantics.
        expect(await skillsService.findById(TENANT, created.id)).toBeNull();
      });

      it("updates the files (jsonb) column via sql.json without corrupting it", async () => {
        const created = await skillsService.create(TENANT, {
          name: "files-skill",
          system_prompt: "You are helpful",
        });

        const files = [
          {
            name: "a.md",
            path: "/a.md",
            type: "reference" as const,
            content: "hello",
          },
        ];
        const updated = await skillsService.update(TENANT, created.id, {
          files,
        });

        expect(updated!.files).toEqual(files);
      });

      it("handles an empty/no-op update payload without crashing", async () => {
        const created = await skillsService.create(TENANT, {
          name: "noop-skill",
          system_prompt: "You are helpful",
        });

        const updated = await skillsService.update(TENANT, created.id, {});

        expect(updated).not.toBeNull();
        expect(updated!.name).toBe("noop-skill");
      });

      it("returns null for a non-existent id instead of throwing", async () => {
        const result = await skillsService.update(
          TENANT,
          "00000000-0000-0000-0000-000000000000",
          { name: "ghost" }
        );
        expect(result).toBeNull();
      });
    });

    // -------------------------------------------------------------------
    // BUG 2 — system-variables encoding consistency between create/update
    // -------------------------------------------------------------------
    describe("SystemVariablesService — value encoding parity", () => {
      it("stores a string value single-encoded on create", async () => {
        const created = await systemVariablesService.create(TENANT, {
          name: "str-var",
          type: "string",
          value: "hello",
        });
        expect(created.value).toBe("hello");

        const [rawText] = await sql`
          SELECT value::text AS raw FROM system_variables WHERE id = ${created.id}
        `;
        // Single-encoded jsonb scalar string: exactly `"hello"`, not
        // `"\"hello\""`.
        expect(rawText.raw).toBe('"hello"');
      });

      it("stores an object value single-encoded on create", async () => {
        const created = await systemVariablesService.create(TENANT, {
          name: "obj-var",
          type: "json",
          value: { key: "val" },
        });
        expect(created.value).toEqual({ key: "val" });

        const [rawText] = await sql`
          SELECT value::text AS raw FROM system_variables WHERE id = ${created.id}
        `;
        expect(rawText.raw.replace(/\s/g, "")).toBe('{"key":"val"}');
      });

      it("stores number and boolean values single-encoded on create", async () => {
        const num = await systemVariablesService.create(TENANT, {
          name: "num-var",
          type: "number",
          value: 42,
        });
        expect(num.value).toBe(42);

        const bool = await systemVariablesService.create(TENANT, {
          name: "bool-var",
          type: "boolean",
          value: true,
        });
        expect(bool.value).toBe(true);
      });

      it("update preserves the same single-encoding depth as create", async () => {
        const created = await systemVariablesService.create(TENANT, {
          name: "roundtrip-var",
          type: "string",
          value: "original",
        });

        const updated = await systemVariablesService.update(
          TENANT,
          created.id,
          { value: "changed" }
        );
        expect(updated!.value).toBe("changed");

        const [createdRaw] = await sql`
          SELECT value::text AS raw FROM system_variables WHERE id = ${created.id}
        `;
        // Same encoding depth as the create-path assertion above: one
        // JSON.stringify, not two.
        expect(createdRaw.raw).toBe('"changed"');

        // Read back through the service too (mirrors what
        // system-variables.provider.ts's single JSON.parse expects).
        const persisted = await systemVariablesService.findById(
          TENANT,
          created.id
        );
        expect(persisted!.value).toBe("changed");
      });
    });
  }
);

// ---------------------------------------------------------------------
// BUG 3 — JobsPostgresRepository.delete() cascading job_executions
// ---------------------------------------------------------------------
describe.skipIf(!TEST_POSTGRES_URL)(
  "JobsPostgresRepository.delete — cascade against real Postgres",
  () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sql: any;
    let JobsPostgresRepository: typeof import("../../src/modules/jobs/jobs.postgres.repository").JobsPostgresRepository;
    let repository: InstanceType<typeof JobsPostgresRepository>;

    const TENANT = "job-delete-cascade-tenant";

    beforeAll(async () => {
      const postgres = (await import("postgres")).default;
      sql = postgres(TEST_POSTGRES_URL as string);

      await sql`
        CREATE TABLE IF NOT EXISTS jobs (
          id UUID PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          agent_id UUID NOT NULL,
          schedule VARCHAR(255) NOT NULL,
          payload JSONB DEFAULT '{}'::jsonb,
          is_active BOOLEAN DEFAULT true,
          last_run TIMESTAMPTZ,
          next_run TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS job_executions (
          id UUID PRIMARY KEY,
          job_id UUID NOT NULL REFERENCES jobs(id),
          status VARCHAR(20) NOT NULL,
          event_payload JSONB DEFAULT '{}'::jsonb,
          result JSONB,
          logs TEXT[] DEFAULT '{}',
          error_message TEXT,
          retry_count INTEGER DEFAULT 0,
          triggered_by VARCHAR(20),
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`DELETE FROM job_executions`;
      await sql`DELETE FROM jobs`;

      ({ JobsPostgresRepository } = await import(
        "../../src/modules/jobs/jobs.postgres.repository"
      ));

      const connectionManager = {
        ensureSchema: async () => sql,
        getConnection: () => sql,
      };

      repository = new JobsPostgresRepository(connectionManager as never);
    });

    afterAll(async () => {
      await sql`DELETE FROM job_executions`;
      await sql`DELETE FROM jobs`;
      await sql.end();
    });

    it("deletes a job that has executions without raising a foreign_key_violation", async () => {
      const job = await repository.create(TENANT, {
        name: "job-with-executions",
        agent_id: "11111111-1111-1111-1111-111111111111",
        schedule: "interval:60",
      });

      await sql`
        INSERT INTO job_executions (id, job_id, status)
        VALUES
          (gen_random_uuid(), ${job.id}, 'completed'),
          (gen_random_uuid(), ${job.id}, 'failed')
      `;

      const deleted = await repository.delete(TENANT, job.id);
      expect(deleted).toBe(true);

      const [{ count: jobCount }] = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM jobs WHERE id = ${job.id}
      `;
      expect(Number(jobCount)).toBe(0);

      const [{ count: execCount }] = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM job_executions WHERE job_id = ${job.id}
      `;
      expect(Number(execCount)).toBe(0);
    });

    it("still deletes a job that has no executions", async () => {
      const job = await repository.create(TENANT, {
        name: "job-without-executions",
        agent_id: "11111111-1111-1111-1111-111111111111",
        schedule: "interval:60",
      });

      const deleted = await repository.delete(TENANT, job.id);
      expect(deleted).toBe(true);
    });

    it("returns false for a non-existent job", async () => {
      const deleted = await repository.delete(
        TENANT,
        "00000000-0000-0000-0000-000000000000"
      );
      expect(deleted).toBe(false);
    });
  }
);
