/**
 * `@yoizen/platform-sdk/agents` — the `agents` resource client
 * (`admin/agents`). See sdk/README.md "Resource clients" for the pattern
 * this follows (from the `workflows` reference implementation).
 */

export type {
  AgentCallOptions,
  AgentsClient,
  AgentsClientDeps,
} from "./client.js";
export { createAgentsClient } from "./client.js";
export type {
  Agent,
  AgentMemoryProposal,
  AgentMemoryProposalActionResult,
  AgentVersion,
  CreateAgentInput,
  ListAgentMemoryProposalsResult,
  ListAgentsPage,
  ListAgentsParams,
  UpdateAgentInput,
  UpdateEnabledMcpServersInput,
  UpdateEnabledMcpToolsInput,
  UpdateEnabledToolsInput,
  UpdateToolDescriptionOverridesInput,
} from "./types.js";
