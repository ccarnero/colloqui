/**
 * mcp-repo-support-bot sample driver — SDK-powered, mirrors
 * ../telegram-transform-reply/src/index.ts.
 *
 * `run.sh` execs this file to drive ONE end-to-end exchange. By default it
 * turns on SIMULATE_INBOUND (unless the caller set it explicitly), so the
 * chain (triage -> route -> conditional[mcpCall DeepWiki -> summarize -> reply])
 * runs without needing a live Telegram bot: setup.ts posts a signed synthetic
 * inbound update to the webhook ingest endpoint and polls for the resulting
 * workflow execution.
 *
 * With a real TELEGRAM_BOT_TOKEN (+ TG_PUBLIC_URL for webhook registration),
 * the outbound reply is delivered for real — just message the bot instead of
 * simulating. Everything else (provisioning, idempotency, RECREATE) is the
 * same as `./setup.sh`.
 */
import { main as runSetup } from "./setup.js";

async function main(): Promise<void> {
  // Default the synthetic drive ON for the run driver, but let an explicit
  // SIMULATE_INBOUND=0 opt out (e.g. when messaging a real bot manually).
  if (process.env.SIMULATE_INBOUND === undefined) {
    process.env.SIMULATE_INBOUND = "1";
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log(
      "[run] TELEGRAM_BOT_TOKEN not set — provisioning + simulating with a placeholder token."
    );
    console.log(
      "[run]   The workflow execution is still observable; only the OUTBOUND Telegram reply will 404."
    );
    console.log(
      "[run]   For real delivery: cp env.example .env, set TELEGRAM_BOT_TOKEN, then re-run with RECREATE=1."
    );
  }

  console.log(
    "[run] provisioning mcp-repo-support-bot + driving one exchange..."
  );
  await runSetup();
}

main().catch((e) => {
  console.error("[run] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
