// Pure consumer-identity authorization policy for the secrets broker
// (SPEC.md decision 5: "consumers present service identity + the resource
// they act for; broker enforces the scope binding"). This is the "who may
// act for which resource kind" half of that enforcement — the (kind, owner,
// secretName) binding match is the other half (see `secrets-broker.service.ts`).
//
// A STATIC map of which platform service identities may resolve secrets for
// which resource kind is sufficient for T05 (the human-approved model does
// not require per-owner ACLs — per-resource isolation of the VALUE is the
// binding match; this layer stops one service impersonating another's role).
// The apply engine (`provisioning-service-apply-engine`) may act for every
// kind because it is the reconciler that creates all of them. Runtime
// consumers are scoped to the kind they legitimately consume:
//   - `channel-service` resolves channel secrets (channel access tokens),
//   - `connector-runtime` resolves connector secrets (auth material),
//   - `agent-ai-service` resolves agent secrets,
//   - `workflow-service` resolves workflow secrets.
// `service` (hosted-service) secrets are delivered k8s-natively (decision 7),
// so only the apply engine writes/reads them through the broker in T05.

import type { ResourceKind } from "../../plan/domain/plan.interfaces";

/** The apply engine's fixed consumer identity — may act for every kind. */
export const APPLY_ENGINE_CONSUMER_SERVICE =
  "provisioning-service-apply-engine";

const CONSUMER_POLICY: Readonly<Record<ResourceKind, ReadonlySet<string>>> = {
  channel: new Set([APPLY_ENGINE_CONSUMER_SERVICE, "channel-service"]),
  connector: new Set([APPLY_ENGINE_CONSUMER_SERVICE, "connector-runtime"]),
  agent: new Set([APPLY_ENGINE_CONSUMER_SERVICE, "agent-ai-service"]),
  service: new Set([APPLY_ENGINE_CONSUMER_SERVICE]),
  // T04 (manual-loops/provisioning-manifest-gaps.md, gap 4) — system
  // variables carry NO secretRef wiring today (`value` is plain config, see
  // `manifest.schema.ts`'s systemVariableSchema comment), so no runtime
  // consumer resolves secrets for this kind yet. Only the apply engine is
  // allow-listed, mirroring `service`'s defensive-only entry, purely so
  // `ResourceKind`'s new member type-checks here.
  systemVariable: new Set([APPLY_ENGINE_CONSUMER_SERVICE]),
  // T06 (manual-loops/provisioning-manifest-gaps.md, gap 6) — mcpServer
  // `auth`/`headers` fields resolve secretRefs through the SAME broker
  // resolver connectors already use. `mcp-client-service` (agent-ai-service)
  // is the runtime consumer that actually connects to the live MCP server,
  // mirroring `connector-runtime` for connectors — allow-listed alongside the
  // apply engine.
  mcpServer: new Set([APPLY_ENGINE_CONSUMER_SERVICE, "agent-ai-service"]),
  workflow: new Set([APPLY_ENGINE_CONSUMER_SERVICE, "workflow-service"]),
};

/**
 * True iff `consumerService` is permitted to resolve secrets for resources
 * of `kind`. A non-empty consumer that is not in the kind's allow-set is
 * denied — an unknown/empty identity is never authorized.
 */
export function isConsumerAuthorized(
  consumerService: string,
  kind: ResourceKind
): boolean {
  if (!consumerService) {
    return false;
  }
  return CONSUMER_POLICY[kind].has(consumerService);
}
