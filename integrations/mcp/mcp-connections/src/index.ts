/**
 * mcp-connections sample driver — SDK-powered, mirrors
 * ../../http/http-connectors/src/index.ts.
 *
 * This sample has no separate "call" step of its own: running it just
 * (re)provisions the MCP server, agent, and workflow, same as `./setup.sh`.
 * The mcp server url is fake/unreachable by design, so there is nothing
 * further to "run" against it — see src/setup.ts for what each stage
 * demonstrates.
 */
import { provisionMcpConnections } from "./setup.js";

console.log("[run] provisioning MCP connections sample...");

provisionMcpConnections().catch((e) => {
  console.error("[run] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
