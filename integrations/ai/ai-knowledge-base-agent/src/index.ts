/**
 * ai-knowledge-base-agent sample driver — SDK-powered replacement for the
 * old curl+jq `run.sh` body.
 *
 * Provisioning is now declarative (`manifest.yaml` + `yoizen manifests
 * apply`, see README.md) — the deleted `src/setup.ts` (KB creation, document
 * upload, ingestion polling, agent upsert) is replaced by that manifest. This
 * file only VERIFIES the already-provisioned KB-backed agent and drives one
 * runtime execution:
 *   1. Resolves the agent id by name via `client.agents.list()`.
 *   2. Submits one runtime execution via `client.runtime.createExecution()`.
 *   3. Polls `client.runtime.getExecution()` until `completed`/`failed` or
 *      POLL_TIMEOUT_S elapses, then prints the result.
 *
 * Prerequisite: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
 * once first (see README.md). This script never creates or modifies
 * platform objects.
 *
 * All configuration comes from environment variables, matching the names
 * `../lib/resolve-env.sh` exports and `.env.example` documents — this file
 * is invoked by `run.sh` after that resolution has already happened.
 */
import { createClient } from "@yoizen/platform-sdk";
import type { ExecutionResultPayload } from "@yoizen/platform-sdk/runtime";

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

async function main(): Promise<void> {
  const tenant = requireEnv("YOIZEN_TENANT");
  const email = requireEnv("YOIZEN_EMAIL");
  const password = requireEnv("YOIZEN_PASSWORD");
  const baseUrl = requireEnv("YOIZEN_BASE_URL");
  const hostHeader = process.env.YOIZEN_HOST_HEADER;

  const agentName = process.env.AI_AGENT_NAME ?? "ai-sample-kb-agent";
  const agentMessage =
    process.env.AI_AGENT_MESSAGE ??
    "According to the support FAQ, what is the refund policy? Include the verification phrase if you see one.";
  const pollTimeoutS = Number(process.env.POLL_TIMEOUT_S ?? "120");

  // The gateway's dev ingress routes by Host header (see
  // ../lib/resolve-env.sh); the SDK's fetch-based transport needs it passed
  // as a regular header since we're talking to a bare IP/localhost port.
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

  console.log(
    `[run] 1/3 resolving agent '${agentName}' (run 'yoizen manifests apply -f manifest.yaml --secrets-from-env' first if this fails)...`
  );
  let agentId: string | undefined;
  for await (const agent of client.agents.list({ pageSize: 100 })) {
    if (agent.name === agentName && agent.is_active !== false) {
      agentId = agent.id;
      break;
    }
  }
  if (!agentId) {
    console.error(
      `[run] agent '${agentName}' not found — apply manifest.yaml first`
    );
    process.exit(1);
  }
  console.log(`[run]     agent found (id=${agentId})`);

  console.log("[run] 2/3 creating runtime execution (KB-backed question)...");
  const { executionId } = await client.runtime.createExecution({
    agentId,
    message: agentMessage,
    conversationId: "ai-knowledge-base-agent",
    channel: "sample",
    customerName: "SDK Sample",
    userId: "sdk-sample",
    context: [],
  });
  console.log(`[run]     execution id=${executionId}`);

  console.log("[run] 3/3 polling execution result...");
  const deadline = Date.now() + pollTimeoutS * 1000;

  while (true) {
    const status = await client.runtime.getExecution(executionId);
    const state = status.state;

    if (state === "completed") {
      const result = status.result as ExecutionResultPayload & {
        text?: string;
      };
      console.log("[run]     completed");
      console.log(
        JSON.stringify(
          {
            executionId: status.executionId,
            state,
            agentId: status.agentId,
            reply: result.reply ?? result.response ?? result.text ?? null,
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

    if (state === "failed") {
      console.error("[run] execution failed");
      console.error(JSON.stringify(status, null, 2));
      process.exit(1);
    }

    if (Date.now() >= deadline) {
      console.error(
        `[run] timed out waiting for execution ${executionId}; last state=${state || "unknown"}`
      );
      console.error(JSON.stringify(status, null, 2));
      process.exit(1);
    }

    await sleep(2);
  }
}

main().catch((err) => {
  console.error("[run] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
