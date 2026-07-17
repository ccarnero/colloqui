// `IPlatformResourceWriter` PLACEHOLDER for `skill` (T01,
// manual-loops/provisioning-manifest-gaps-3.md, workstream a).
//
// T01's own task text scopes the schema + planner (comparable fields,
// desired-fields, live-listing client, `RESOURCE_KIND_ORDER`) — the REAL
// create-or-update writer is explicitly T04's job
// ("skills apply-engine writer + migrate ai-skill-support-agent"), mirroring
// `mcp-servers-writer.ts`/`agents-writer.ts`'s name-lookup shape via
// `client.skills.list/create/update`.
//
// BUT `PlatformResourceWriters` (`platform-resource-writer.interface.ts`) is
// `Readonly<Record<ResourceKind, IPlatformResourceWriter>>` — a TOTAL map
// over the SAME union `secretScopeKindSchema` powers. The moment T01 adds
// "skill" to that schema (decision 4, required so the `ResourceKind =
// SecretScopeKind` type alias keeps compiling), `buildPlatformResourceWriters`
// (`platform-resource-writers.provider.ts`) requires a "skill" entry to
// typecheck — independent of `RESOURCE_KIND_ORDER` placement. This file is
// that TYPE-SATISFYING STUB ONLY: no manifest declares a `skills[]` entry
// until T04 migrates `ai-skill-support-agent` (the first and only one), so
// `create`/`update` are never invoked by the regression set today. T04
// REPLACES this file's body with the real writer — this is not new writer
// functionality, it is the minimum needed to keep `services/provisioning-service`
// compiling once `skill` is a full `ResourceKind` member.
//
// Precedent for a defensive-only entry gaining a `ResourceKind` member ahead
// of its real runtime consumer: `secret-consumer-policy.ts`'s `systemVariable`
// entry (T04, gap 4) is allow-listed for the apply engine ONLY, "purely so
// `ResourceKind`'s new member type-checks" — the same posture this file takes
// for the writer side.

import { PinoLoggerService } from "@yoizen/observability";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

export function createSkillsWriter(): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.skill-writer");

  function notImplemented(resourceName: string): CreateOrUpdateResult {
    const message =
      "skills writer not yet implemented — T01 (manual-loops/provisioning-manifest-gaps-3.md) " +
      "only wires 'skill' through the schema/planner; T04 ships the real " +
      "create-or-update writer (mirrors mcp-servers-writer.ts/agents-writer.ts)";
    logger.warn(`create/update: ${message} skill='${resourceName}'`);
    return {
      ok: false,
      error: {
        kind: "unsupported_kind_shape",
        resourceKind: "skill",
        resourceName,
        message,
      },
    };
  }

  return {
    async create(_tenantId, resource) {
      const name =
        typeof (resource as { name?: unknown }).name === "string"
          ? (resource as { name: string }).name
          : "<unknown>";
      return notImplemented(name);
    },
    async update(_tenantId, _externalId, resource) {
      const name =
        typeof (resource as { name?: unknown }).name === "string"
          ? (resource as { name: string }).name
          : "<unknown>";
      return notImplemented(name);
    },
  };
}
