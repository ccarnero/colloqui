/**
 * ai-skill-support-agent sample driver — SDK-powered. Provisioning is now
 * declarative (`manifest.yaml` + `yoizen manifests apply`, see README.md);
 * this script only VERIFIES the already-provisioned agent.
 *
 * Requires `yoizen manifests apply -f manifest.yaml --secrets-from-env` to
 * have provisioned the skill/KB-backed agent first (see README.md).
 *
 * Flow: resolve agent by name -> submit three /api/runtime/executions and
 * poll each to completion:
 *   1. A refund-window question that starts with the skill trigger ("refund")
 *      so the skill router activates 'refund-policy-expert' by trigger match.
 *   2. A shipping-SLA question grounded in the knowledge base.
 *   3. An out-of-policy refund demand, to show the rules guardrail (decline +
 *      escalation offer, no promised refund).
 *
 * Contract sources (verified in code, paths relative to repo root):
 *   - Runtime exec : services/api-gateway/src/modules/runtime/runtime.controller.ts
 *   - Skill router : services/agent-ai-service/src/modules/skills/skill-router.service.ts
 *                    (trigger match = userMessage startsWith(trigger))
 */
import { createClient } from "@yoizen/platform-sdk";
import type { ExecutionStatus } from "@yoizen/platform-sdk/runtime";

// ----- Pretty logging (verbose; nothing fails silently) ---------------------
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";
const log = (msg: string) => console.log(`${GREEN}[INFO]${NC}  ${msg}`);
const step = (msg: string) => console.log(`${BLUE}[STEP]${NC}  ${msg}`);
const warn = (msg: string) => console.log(`${YELLOW}[WARN]${NC}  ${msg}`);
const err = (msg: string) => console.error(`${RED}[ERR]${NC}   ${msg}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

const AGENT_NAME = process.env.AI_AGENT_NAME ?? "ai-sample-support";
const POLL_TIMEOUT_S = Number(process.env.POLL_TIMEOUT_S ?? "120");

const tenant = requireEnv("YOIZEN_TENANT");
const email = requireEnv("YOIZEN_EMAIL");
const password = requireEnv("YOIZEN_PASSWORD");
const baseUrl = requireEnv("YOIZEN_BASE_URL");
const hostHeader = process.env.YOIZEN_HOST_HEADER;

// The gateway's dev ingress routes by Host header (see ../lib/resolve-env.sh);
// the SDK's fetch-based transport needs it passed as a regular header since
// we're talking to a bare IP/localhost port.
const fetchWithHostHeader: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (hostHeader) {
    headers.set("Host", hostHeader);
  }
  return fetch(input, { ...init, headers });
};

const client = createClient({
  tenant,
  email,
  password,
  baseUrl,
  fetch: hostHeader ? fetchWithHostHeader : undefined,
});

let agentId = "";

async function stageResolveAgent(): Promise<void> {
  step(`resolve agent '${AGENT_NAME}'`);
  for await (const agent of client.agents.list()) {
    if (agent.name === AGENT_NAME && (agent.is_active ?? true)) {
      agentId = agent.id;
      break;
    }
  }
  if (!agentId) {
    err(`Agent '${AGENT_NAME}' not found. Run ./setup.sh first.`);
    process.exit(1);
  }
  log(`agent id=${agentId}`);
}

// ask <label> <message> — submits one runtime execution and polls it to
// completion, printing the reply. Throws on failure/timeout so `main()`
// stops at the first bad question, matching the bash script's `set -e`
// behavior (an unchecked non-zero return from `ask` aborted the script).
async function ask(label: string, message: string): Promise<void> {
  step(`ask: ${label}`);
  log(`question: ${message}`);

  const { executionId } = await client.runtime.createExecution({
    agentId,
    message,
    conversationId: "ai-skill-support-agent",
    channel: "sample",
    customerName: "SDK Sample",
    userId: "sdk-sample",
    context: [],
  });
  if (!executionId) {
    throw new Error("Execution submit failed: no executionId returned");
  }
  log(`execution id=${executionId}`);

  const deadline = Date.now() + POLL_TIMEOUT_S * 1000;
  for (;;) {
    const status: ExecutionStatus =
      await client.runtime.getExecution(executionId);
    const state = status.state ?? "";
    switch (state) {
      case "completed": {
        log("completed");
        const result = status.result ?? {};
        console.log(
          JSON.stringify(
            {
              executionId: status.executionId,
              state,
              reply: result.reply ?? result.response ?? null,
              usage: result.usage,
              provider: result.provider,
              model: result.model,
              costUsd: result.costUsd,
              toolCalls: result.toolCalls ?? [],
            },
            null,
            2
          )
        );
        return;
      }
      case "failed":
        err("execution failed");
        console.error(JSON.stringify(status, null, 2));
        throw new Error(`execution ${executionId} failed`);
      case "pending":
      case "running":
      case "accepted":
      case "queued":
      case "":
        if (Date.now() >= deadline) {
          err(
            `timed out waiting for execution ${executionId}; last state=${state || "unknown"}`
          );
          console.error(JSON.stringify(status, null, 2));
          throw new Error(`timed out waiting for execution ${executionId}`);
        }
        await sleep(2);
        break;
      default:
        warn(`unknown state '${state}', continuing`);
        await sleep(2);
        break;
    }
  }
}

async function main(): Promise<void> {
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
  await stageResolveAgent();

  // 1. Skill-trigger path: message starts with "refund" -> trigger match.
  await ask(
    "refund window (skill trigger)",
    "refund question: I bought a SmartHub router 20 days ago and it works fine, I just do not want it anymore. Can I get my money back, and is there any fee?"
  );

  // 2. KB-grounded path: shipping SLA facts live only in the policy document.
  await ask(
    "shipping SLA (knowledge base)",
    "My express shipment to a metro area is 4 business days late. What is the express shipping SLA and am I entitled to anything?"
  );

  // 3. Guardrail path: out-of-policy demand, agent must decline and escalate.
  await ask(
    "out-of-policy demand (rules guardrail)",
    "I bought a phone 90 days ago and I demand a full cash refund today or I will post about it everywhere. Give me the refund now."
  );

  log(
    "done — compare the three replies: trigger-activated skill, KB-grounded answer, and the policy guardrail."
  );
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
