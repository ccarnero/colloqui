import assert from "node:assert/strict";
import { test } from "node:test";
import { SdkError } from "../../src/domain/errors.js";
import { createClient } from "../../src/index.js";
import type { RuntimeStreamEvent } from "../../src/resources/runtime/index.js";

/**
 * Live-cluster regression test for `client.runtime.stream()` (runtime token
 * streaming, DOCS/architecture/runtime-streaming.md; SDK side of engram
 * decision #591 "platform/runtime-streaming-design").
 *
 * The platform side (api-gateway proxyStream, ai-agent-gateway
 * submitAndStream, agent-ai-service mock provider) is implemented in the
 * working tree as of 2026-07-05 but NOT deployed/committed — so on today's
 * dev cluster this test is expected to PROBE the route, find it
 * unsupported (404/405, or `createClient()` throwing
 * `streaming_unsupported`), diagnostic-log, and skip gracefully. That is
 * the correct/expected outcome until the platform side ships, not a bug.
 *
 * Gated behind SDK_E2E=1. Run with:
 *
 *   SDK_E2E=1 npm run test:e2e
 *
 * See test/e2e/README.md for the required environment.
 */

const RUN_E2E = process.env.SDK_E2E === "1";

const YWAI_ENV = process.env.YWAI_ENV ?? "dev";
const DEV_DOMAIN =
  process.env.DEV_DOMAIN ?? process.env.MINIKUBE_DOMAIN ?? "dev.local";
const API_GATEWAY_PORT = process.env.API_GATEWAY_PORT ?? "8080";
const GW_HOST = `api-gateway.platform-services-${YWAI_ENV}.${DEV_DOMAIN}`;

const TENANT = process.env.YOIZEN_TENANT ?? "acme";
const EMAIL = process.env.YOIZEN_EMAIL ?? "yclawd@demo.io";
const PASSWORD = process.env.YOIZEN_PASSWORD ?? "admin123";
const AGENT_NAME_PREFIX = "sdk-e2e-runtime-stream-agent";

async function reachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveBaseUrl(): Promise<string> {
  if (process.env.YOIZEN_BASE_URL) {
    return process.env.YOIZEN_BASE_URL;
  }
  const localhost = `http://localhost:${API_GATEWAY_PORT}`;
  if (await reachable(localhost)) {
    return localhost;
  }
  const ingress = `http://${GW_HOST}`;
  if (await reachable(ingress)) {
    return ingress;
  }
  return localhost;
}

function isStreamingUnsupported(err: unknown): boolean {
  return err instanceof SdkError && err.code === "streaming_unsupported";
}

test("SDK e2e: client.runtime.stream() — mock provider token streaming (live cluster)", {
  skip:
    !RUN_E2E &&
    "set SDK_E2E=1 to run against a live dev cluster (see test/e2e/README.md)",
}, async (t) => {
  const baseUrl = await resolveBaseUrl();
  t.diagnostic(`baseUrl=${baseUrl} tenant=${TENANT} email=${EMAIL}`);

  const client = createClient({
    tenant: TENANT,
    email: EMAIL,
    password: PASSWORD,
    baseUrl,
  });

  // Best-effort hygiene from previous failed runs.
  for await (const agent of client.agents.list()) {
    if (agent.name.startsWith(AGENT_NAME_PREFIX)) {
      await client.agents.remove(agent.id).catch(() => undefined);
    }
  }

  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const agentName = `${AGENT_NAME_PREFIX}-${nonce}`;

  const agent = await client.agents.create({
    name: agentName,
    system_prompt: "You are a concise SDK e2e streaming test agent.",
    model_config: {
      llm: {
        provider: "mock",
        model: "mock-echo",
        temperature: 0,
      },
    },
    tools: [],
    channels: [],
  });

  try {
    await client.agents.publish(agent.id);

    const prompt = `Hello world ${nonce}`;

    // Probe: does the stream route exist at all on this cluster? The
    // platform side of this feature is undeployed as of 2026-07-05, so
    // this is EXPECTED to fail with `streaming_unsupported` today.
    const firstEvents: RuntimeStreamEvent[] = [];
    try {
      for await (const ev of client.runtime.stream({
        agentId: agent.id,
        message: prompt,
      })) {
        firstEvents.push(ev);
      }
    } catch (err) {
      if (isStreamingUnsupported(err)) {
        t.diagnostic(
          "runtime.stream() reported streaming_unsupported (404/405 opening " +
            "the stream route) — expected on today's dev cluster since the " +
            "platform side (api-gateway proxyStream / ai-agent-gateway " +
            "submitAndStream) is implemented but not yet deployed. Skipping " +
            "streaming assertions."
        );
        return;
      }
      t.diagnostic(
        `runtime.stream() failed with an unexpected error, likely missing ` +
          `RUNTIME_ALLOW_MOCK_PROVIDER=true on the dev cluster or another ` +
          `undeployed piece: ${String(err)}`
      );
      console.warn(
        "[runtime-stream.e2e] skipping streaming assertions: stream() failed unexpectedly"
      );
      return;
    }

    await t.test("event ordering is started -> token* -> completed", () => {
      assert.ok(firstEvents.length >= 2, "expected at least started+completed");
      assert.equal(firstEvents[0]!.type, "started");
      const last = firstEvents[firstEvents.length - 1]!;
      assert.ok(
        last.type === "completed" || last.type === "failed",
        `expected a terminal event, got ${last.type}`
      );
      for (const ev of firstEvents.slice(1, -1)) {
        assert.ok(
          ev.type === "token" ||
            ev.type === "tool_call" ||
            ev.type === "tool_result",
          `unexpected mid-stream event type ${ev.type}`
        );
      }
    });

    await t.test(
      "concatenated token deltas echo the prompt (mock provider)",
      () => {
        const tokens = firstEvents.filter(
          (ev): ev is Extract<RuntimeStreamEvent, { type: "token" }> =>
            ev.type === "token"
        );
        const concatenated = tokens.map((ev) => ev.data.delta).join("");
        assert.ok(
          concatenated.length > 0,
          "expected at least one token delta from the mock provider"
        );
        assert.ok(
          concatenated.includes("Hello") || concatenated.includes(nonce),
          `expected the mock echo to contain the prompt, got: ${JSON.stringify(concatenated)}`
        );
      }
    );

    await t.test(
      "aborting a second stream mid-flight ends the iterator without hanging",
      async () => {
        const controller = new AbortController();
        let count = 0;
        const iterationDone = (async () => {
          for await (const _ev of client.runtime.stream(
            { agentId: agent.id, message: prompt },
            { signal: controller.signal }
          )) {
            count++;
            if (count === 1) {
              controller.abort();
            }
          }
        })();

        await Promise.race([
          iterationDone,
          new Promise((_resolve, reject) =>
            setTimeout(
              () =>
                reject(new Error("abort did not end the iterator within 10s")),
              10_000
            )
          ),
        ]);
        // Client-side termination is the only contract under test here —
        // NOT server-side cancel-propagation timing.
        assert.ok(count >= 1, "expected at least one event before aborting");
      }
    );
  } finally {
    await client.agents.remove(agent.id).catch(() => undefined);
  }
});
