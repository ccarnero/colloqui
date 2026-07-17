// `IPlatformResourceWriter` for agent-admin-service's `POST /admin/skills` /
// `PATCH /admin/skills/:id` (T04, manual-loops/provisioning-manifest-gaps-3.md
// workstream a). REPLACES T01's type-satisfying stub (see this file's prior
// header, now obsolete) — a manifest CAN declare a `skills[]` entry from this
// task onward.
//
// Shape mirrors `mcp-servers-writer.ts` exactly (create-or-update-by-name is
// the PLANNER's job via `skills-client.ts`'s `createHttpListResourceClient`
// name lookup, T01 — this writer only ever receives the externalId the plan
// already resolved; it never lists/looks up by name itself): POST/PATCH
// against the SAME agent-admin-service base URL as agents/mcpServers/
// systemVariables, fail loud with a typed `downstream_error` on network
// failure, non-2xx, or malformed JSON — no auth/secretRef handling at all,
// since NO `skillSchema` field is credential-capable (decision 4 — verified
// against `CreateSkillDto`/`UpdateSkillDto`, no auth/token/key/secret field
// anywhere).
//
// `update()` is a NORMAL working call (decision 5 — the historical
// `SkillsService.update` HTTP-500 bug from the dynamic-SET-clause
// `Array.prototype.join` anti-pattern is FIXED server-side, live-verified
// 2026-07-05 by `admin-resources.e2e.ts` and again 2026-07-17 by the
// orchestrator probe): no special-casing, no "expect the 500" branch, exactly
// like `mcp-servers-writer.ts`/`agents-writer.ts`'s own update paths.
//
// The body sent on BOTH create and update mirrors `skillComparable`
// (`comparable-fields.ts`)'s `fromManifest` field set verbatim (name always
// sent; every optional field passed through only when the manifest declares
// it, letting agent-admin-service apply its own fixed server-side defaults
// for anything omitted — the SAME defaults `skillComparable.fromManifest`
// already mirrors so the plan never re-diffs a server default as a forever
// drift).

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { ManifestSkill } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

function buildSkillBody(skill: ManifestSkill): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: skill.name,
    // `system_prompt` is required on create by `CreateSkillDto`; the schema
    // already enforces `min(1)` on it, so it's always present here.
    system_prompt: skill.system_prompt,
  };
  if (skill.description !== undefined) {
    body.description = skill.description;
  }
  if (skill.icon !== undefined) {
    body.icon = skill.icon;
  }
  if (skill.color !== undefined) {
    body.color = skill.color;
  }
  if (skill.trigger_commands !== undefined) {
    body.trigger_commands = skill.trigger_commands;
  }
  if (skill.when_to_use !== undefined) {
    body.when_to_use = skill.when_to_use;
  }
  if (skill.priority !== undefined) {
    body.priority = skill.priority;
  }
  if (skill.allowed_tools !== undefined) {
    body.allowed_tools = skill.allowed_tools;
  }
  if (skill.mode !== undefined) {
    body.mode = skill.mode;
  }
  if (skill.files !== undefined) {
    body.files = skill.files;
  }
  return body;
}

export function createSkillsWriter(baseUrl: string): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.skills-writer");

  return {
    async create(tenantId, resourceUnknown): Promise<CreateOrUpdateResult> {
      const skill = resourceUnknown as ManifestSkill;
      const body = buildSkillBody(skill);
      const url = `${baseUrl}/admin/skills`;
      logger.log(
        `create: POST ${url} skill='${skill.name}' mode='${skill.mode ?? "llm_driven"}' tenant='${tenantId}'`
      );

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "POST",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "skill",
            resourceName: skill.name,
            message,
          },
        };
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "skill",
            resourceName: skill.name,
            message,
          },
        };
      }

      let created: { id: string };
      try {
        created = (await response.json()) as { id: string };
      } catch (cause) {
        const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "skill",
            resourceName: skill.name,
            message,
          },
        };
      }

      logger.log(
        `create: skill '${skill.name}' created -> externalId='${created.id}'`
      );
      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      tenantId,
      externalId,
      resourceUnknown
    ): Promise<CreateOrUpdateResult> {
      const skill = resourceUnknown as ManifestSkill;
      const body = buildSkillBody(skill);
      const url = `${baseUrl}/admin/skills/${externalId}`;
      logger.log(
        `update: PATCH ${url} skill='${skill.name}' tenant='${tenantId}'`
      );

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "PATCH",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`update: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "skill",
            resourceName: skill.name,
            message,
          },
        };
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`update: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "skill",
            resourceName: skill.name,
            message,
          },
        };
      }

      logger.log(
        `update: skill '${skill.name}' updated -> externalId='${externalId}'`
      );
      return { ok: true, value: { externalId } };
    },
  };
}
