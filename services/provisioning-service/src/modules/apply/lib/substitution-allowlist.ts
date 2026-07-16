// manual-loops/provisioning-manifest-gaps.md T03, gap 3, decision 4.
//
// HUMAN RULING (decision 4, resolved 2026-07-16): EXPLICIT ALLOWLIST.
// Manifest-time ID substitution walks ONLY the argument keys listed below —
// NEVER a structural walk that substitutes every key literally named
// "*Ref" wherever it appears in a workflow/agent tree. A structural walk
// would silently substitute an unrelated same-named key (e.g. a user's own
// `config.agentRef` field that isn't actually a workflow action argument);
// the allowlist trades that risk for an explicit, auditable list.
//
// THIS IS THE ONE PLACE THE ALLOWLIST LIVES. Keep it in sync BY HAND with
// `@yoizen/shared`'s workflow action argument types (`workflow.interfaces.ts`)
// — there is no automatic derivation, no codegen, no lint rule enforcing
// this file matches that one. Whenever a new/changed workflow action adds
// an argument that should resolve a manifest resource by name, add (or
// update) an entry here AND cite the exact `@yoizen/shared` type + field it
// mirrors, the same way the four entries below do.
//
// Each entry pairs one action/tool argument key with the ONE symbolic ref
// kind (`SymbolicRefType`, `@yoizen/shared` manifest.schema.ts) it accepts.
// The recognized ref-object VALUE shape is `{ <refType>: <manifestName> }`
// (a single-key object) — see `substitute-symbolic-refs.ts`.

import type { SymbolicRefType } from "@yoizen/shared";

export interface SubstitutionAllowlistEntry {
  /** The workflow/agent-tree argument key this entry governs. */
  readonly argKey: string;
  /** The ONE ref kind accepted as this argument's ref-object value. */
  readonly refType: SymbolicRefType;
  /** The exact @yoizen/shared type + field this argument mirrors. */
  readonly source: string;
}

export const SUBSTITUTION_ALLOWLIST: readonly SubstitutionAllowlistEntry[] = [
  {
    argKey: "accountId",
    refType: "channelRef",
    source:
      "@yoizen/shared workflow.interfaces.ts ChannelSendArgs.accountId — " +
      "the channelSend activity's target channel_accounts row id.",
  },
  {
    argKey: "adapterId",
    refType: "connectorRef",
    source:
      "@yoizen/shared workflow.interfaces.ts EndpointCallArgs.adapterId — " +
      "the endpointCall activity's target connector-admin adapter id.",
  },
  {
    argKey: "agentId",
    refType: "agentRef",
    source:
      "@yoizen/shared workflow.interfaces.ts AgentCallArgs.agentId — " +
      "the agentCall activity's target agent-admin-service agent id.",
  },
  {
    argKey: "serviceId",
    refType: "serviceRef",
    source:
      "@yoizen/shared workflow.interfaces.ts ServiceCallArgs.serviceId — " +
      "the serviceCall activity's target registered_services row id.",
  },
  // manual-loops/provisioning-manifest-gaps.md T06, gap 6. NOTE: this is the
  // ONLY place `mcpServerRef` participates in name->id substitution — an
  // agent's own `enabledMcpServerRefs` (which also embeds `{ mcpServerRef }`)
  // is DELIBERATELY excluded from this allowlist: agent-ai-service's
  // `enabled_mcp_servers`/`ns` field is keyed by MCP server NAME, not id (see
  // `manifest.schema.ts`'s `agentSchema.enabledMcpServerRefs` comment for the
  // regression this would reintroduce if added here).
  {
    argKey: "serverId",
    refType: "mcpServerRef",
    source:
      "@yoizen/shared workflow.interfaces.ts McpCallArgs.serverId — " +
      "the mcpCall activity's target agent-admin-service MCP server id.",
  },
] as const;

/** `argKey -> refType`, derived once from `SUBSTITUTION_ALLOWLIST` above. */
export const ALLOWLISTED_SUBSTITUTION_KEYS: ReadonlyMap<
  string,
  SymbolicRefType
> = new Map(
  SUBSTITUTION_ALLOWLIST.map((entry) => [entry.argKey, entry.refType])
);
